// Integración con Stockagile (piloto TUILUS). Stockagile manda en el stock de Tuilus y lo envía
// a Shopify; las ventas del TPV ya le llegan por el pedido de Shopify, las devoluciones no.
// - `check` (solo lectura): comprueba el token, encuentra el almacén que corresponde a la
//   ubicación de Shopify del TPV y empareja las últimas variantes vendidas con las de
//   Stockagile, comparando el stock de los dos lados.
// - `push`: envía a Stockagile los movimientos pendientes de la cola stockagile_stock_moves
//   (devoluciones con reposición, 0037) con `POST /stock/move`. Lo llama el TPV tras una
//   devolución y la tarea «stockagile-devoluciones» cada 5 minutos (con ticket).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  createStockagileClient,
  failedMoveStatus,
  findStockagileVariant,
  normalizeStockagileToken,
  pickWarehouse,
  StockagileError,
  STOCKAGILE_PILOT_BUSINESS_ID,
  type StockagileClient,
  type StockagileSiteProduct,
  type StockagileWarehouse,
} from '../_shared/stockagile-core.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SAMPLE_SIZE = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface LocalVariantRow {
  id: string;
  name: string | null;
  barcode: string | null;
  attributes: Record<string, unknown> | null;
  stock_quantity: number | null;
  products: { name: string; external_id: string | null } | null;
}

/** Productos de la tienda online en Stockagile, cargados una sola vez por ejecución. */
function siteProductsLoader(stockagile: StockagileClient) {
  let cache: Promise<StockagileSiteProduct[]> | null = null;
  return () => (cache ??= stockagile.getAll<StockagileSiteProduct>('/site-product', { page_size: 500 }));
}

/** Almacén de Stockagile con el nombre de la ubicación de Shopify del TPV. */
async function resolveWarehouse(admin: SupabaseClient, stockagile: StockagileClient, businessId: string) {
  const { data: connection } = await admin
    .from('shopify_connections')
    .select('default_location_gid')
    .eq('business_id', businessId)
    .maybeSingle();
  const locationGid = (connection as { default_location_gid?: string | null } | null)?.default_location_gid ?? null;
  const { data: location } = locationGid
    ? await admin
        .from('shopify_inventory_levels')
        .select('location_name')
        .eq('business_id', businessId)
        .eq('location_gid', locationGid)
        .limit(1)
        .maybeSingle()
    : { data: null };
  const locationName = (location as { location_name?: string | null } | null)?.location_name ?? null;
  const warehouses = await stockagile.getAll<StockagileWarehouse>('/warehouses', { page_size: 100 });
  return { locationName, warehouses, warehouse: pickWarehouse(warehouses, locationName) };
}

async function loadLocalVariants(admin: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, LocalVariantRow>();
  const { data } = await admin
    .from('product_variants')
    .select('id, name, barcode, attributes, stock_quantity, products(name, external_id)')
    .in('id', ids);
  return new Map(((data ?? []) as unknown as LocalVariantRow[]).map((v) => [v.id, v]));
}

async function check(admin: SupabaseClient, stockagile: StockagileClient, businessId: string) {
  const { locationName, warehouses, warehouse } = await resolveWarehouse(admin, stockagile, businessId);

  // Muestra: las últimas variantes distintas vendidas en el TPV.
  const { data: recentSales } = await admin
    .from('sales')
    .select('sale_items(variant_id)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(40);
  const variantIds = [
    ...new Set(
      ((recentSales ?? []) as { sale_items: { variant_id: string | null }[] }[])
        .flatMap((s) => s.sale_items.map((i) => i.variant_id))
        .filter((id): id is string => !!id),
    ),
  ].slice(0, SAMPLE_SIZE);
  const variants = [...(await loadLocalVariants(admin, variantIds)).values()];
  const loadSiteProducts = siteProductsLoader(stockagile);

  const matches = [];
  for (const v of variants) {
    const m = await findStockagileVariant(
      stockagile,
      { barcode: v.barcode, name: v.name, attributes: v.attributes, shopifyProductGid: v.products?.external_id },
      loadSiteProducts,
    );
    matches.push({
      variant_id: v.id,
      product: v.products?.name ?? '—',
      size: v.name,
      pymova_stock: v.stock_quantity,
      matched_by: m.matchedBy,
      stockagile_variant_id: m.variant?.id ?? null,
      stockagile_stock: null as number | null,
      note: m.note,
    });
  }

  // Stock de esas variantes en el almacén (la API solo filtra por almacén: se pagina hasta tenerlas).
  if (warehouse) {
    const wanted = new Set(matches.map((m) => m.stockagile_variant_id).filter((id): id is number => id != null));
    if (wanted.size > 0) {
      const seen = new Map<number, number>();
      await stockagile.getAll<{ product_variant_id: number; stock: number }>(
        '/stock',
        { warehouse_id: warehouse.id, page_size: 500 },
        {
          maxPages: 40,
          stop: (rows) => {
            for (const r of rows) if (wanted.has(r.product_variant_id)) seen.set(r.product_variant_id, Number(r.stock));
            return seen.size >= wanted.size;
          },
        },
      );
      for (const m of matches) {
        if (m.stockagile_variant_id != null) m.stockagile_stock = seen.get(m.stockagile_variant_id) ?? null;
      }
    }
  }

  return {
    ok: true,
    location_name: locationName,
    warehouse: warehouse ? { id: warehouse.id, name: warehouse.name } : null,
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, is_principal: !!w.is_principal })),
    matches,
  };
}

interface MoveRow {
  id: string;
  local_product_id: string | null;
  local_variant_id: string | null;
  quantity: number;
  reason: string;
}

/** Envía a Stockagile los movimientos pendientes de un negocio. */
async function push(admin: SupabaseClient, stockagile: StockagileClient, businessId: string) {
  const { data: claimed, error: claimError } = await admin.rpc('claim_stockagile_moves', {
    _business_id: businessId,
    _limit: 20,
  });
  if (claimError) throw claimError;
  const moves = (claimed ?? []) as MoveRow[];
  if (moves.length === 0) return { sent: 0, failed: 0, review: 0 };

  const finish = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await admin
      .from('stockagile_stock_moves')
      .update({ processed_at: new Date().toISOString(), ...patch })
      .eq('id', id);
    if (error) console.error('stockagile: no se pudo guardar el movimiento', id, error.message);
  };

  let sent = 0;
  let failed = 0;
  let review = 0;

  // Sin almacén no se envía nada: los movimientos quedan como fallidos (no aplicados).
  let warehouse: StockagileWarehouse | null = null;
  try {
    ({ warehouse } = await resolveWarehouse(admin, stockagile, businessId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    for (const m of moves) await finish(m.id, { status: 'failed', last_error: message });
    return { sent, failed: moves.length, review };
  }
  if (!warehouse) {
    for (const m of moves) {
      await finish(m.id, { status: 'failed', last_error: 'No hay en Stockagile un almacén con el nombre de la tienda' });
    }
    return { sent, failed: moves.length, review };
  }

  // Variantes locales; para un producto sin variante se usa el producto (una sola variante en Stockagile).
  const locals = await loadLocalVariants(admin, moves.map((m) => m.local_variant_id).filter((id): id is string => !!id));
  const productIds = moves.filter((m) => !m.local_variant_id && m.local_product_id).map((m) => m.local_product_id as string);
  const { data: productRows } = productIds.length
    ? await admin.from('products').select('id, external_id').in('id', productIds)
    : { data: [] };
  const productGid = new Map(((productRows ?? []) as { id: string; external_id: string | null }[]).map((p) => [p.id, p.external_id]));
  const loadSiteProducts = siteProductsLoader(stockagile);

  for (const m of moves) {
    const local = m.local_variant_id ? locals.get(m.local_variant_id) : null;
    let match;
    try {
      match = await findStockagileVariant(
        stockagile,
        local
          ? { barcode: local.barcode, name: local.name, attributes: local.attributes, shopifyProductGid: local.products?.external_id }
          : { shopifyProductGid: m.local_product_id ? productGid.get(m.local_product_id) : null },
        loadSiteProducts,
      );
    } catch (error) {
      // Solo lecturas: no se ha movido nada.
      await finish(m.id, { status: 'failed', last_error: error instanceof Error ? error.message : 'Error desconocido' });
      failed++;
      continue;
    }
    if (!match.variant) {
      await finish(m.id, { status: 'failed', last_error: `Sin emparejar en Stockagile: ${match.note ?? 'variante no encontrada'}` });
      failed++;
      continue;
    }

    try {
      await stockagile.post('/stock/move', {
        identifier_type: 'id',
        identifier: String(match.variant.id),
        quantity: m.quantity,
        warehouse_id: warehouse.id,
      });
      await finish(m.id, {
        status: 'done',
        last_error: null,
        stockagile_variant_id: match.variant.id,
        warehouse_id: warehouse.id,
      });
      sent++;
    } catch (error) {
      const status = failedMoveStatus(error);
      const message = error instanceof Error ? error.message : 'Error desconocido';
      await finish(m.id, {
        status,
        stockagile_variant_id: match.variant.id,
        warehouse_id: warehouse.id,
        last_error:
          status === 'review'
            ? `No se sabe si Stockagile lo aplicó (${message}). Compruébalo allí antes de reintentar.`
            : message,
      });
      if (status === 'review') review++;
      else failed++;
    }
  }
  return { sent, failed, review };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = normalizeStockagileToken(Deno.env.get('STOCKAGILE_API_TOKEN'));

    // Tarea programada: sin JWT, con ticket de un solo uso.
    if (hasTicket(body)) {
      if (!(await consumeTicket(admin, body, 'stockagile-push'))) return json({ error: 'Ticket no válido' }, 401);
      if (!token) return json({ error: 'Falta el secreto STOCKAGILE_API_TOKEN' }, 500);
      const { data: connections } = await admin.from('stockagile_connections').select('business_id').eq('enabled', true);
      const stockagile = createStockagileClient(fetch, token);
      const results: Record<string, unknown> = {};
      for (const c of (connections ?? []) as { business_id: string }[]) {
        // El token es de TUILUS: ningún otro negocio puede usarlo.
        if (c.business_id !== STOCKAGILE_PILOT_BUSINESS_ID) continue;
        results[c.business_id] = await push(admin, stockagile, c.business_id);
      }
      return json({ ok: true, results });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const businessId = String(body.business_id ?? '');
    if (businessId !== STOCKAGILE_PILOT_BUSINESS_ID) {
      return json({ error: 'Stockagile no está conectado a este negocio' }, 403);
    }
    if (!token) return json({ error: 'Falta el secreto STOCKAGILE_API_TOKEN' }, 500);
    const stockagile = createStockagileClient(fetch, token);

    const action = String(body.action ?? 'check');
    if (action === 'push') {
      // Lo lanza el TPV tras una devolución: basta con ser miembro del negocio.
      const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
      if (!isMember) return json({ error: 'No tienes acceso a este negocio' }, 403);
      return json({ ok: true, ...(await push(admin, stockagile, businessId)) });
    }
    if (action === 'check') {
      const { data: isAdmin } = await userClient.rpc('has_min_role', { _business_id: businessId, _min_role: 'admin' });
      if (!isAdmin) return json({ error: 'Necesitas permisos de administrador' }, 403);
      return json(await check(admin, stockagile, businessId));
    }
    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (error) {
    const status = error instanceof StockagileError ? 502 : 500;
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('stockagile', message);
    return json({ error: message }, status);
  }
});
