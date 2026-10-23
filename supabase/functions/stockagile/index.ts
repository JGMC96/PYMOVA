// Integración con Stockagile (piloto TUILUS). Stockagile manda en el stock de Tuilus y lo envía
// a Shopify; las ventas del TPV ya le llegan por el pedido de Shopify, las devoluciones no.
// - `check` (solo lectura): comprueba el token, encuentra el almacén que corresponde a la
//   ubicación de Shopify del TPV y empareja las últimas variantes vendidas con las de
//   Stockagile, comparando el stock de los dos lados.
// - `push`: envía a Stockagile los movimientos pendientes de la cola stockagile_stock_moves
//   (devoluciones con reposición, 0037) con `POST /stock/move`. Lo llama el TPV tras una
//   devolución y la tarea «stockagile-devoluciones» cada 5 minutos (con ticket).
// - Ventas de la tienda (0046): copia de consulta de los tickets del TPV de Stockagile en
//   stockagile_sales. La misma tarea trae los de los 2 últimos días; `import-sales` lo hace al
//   momento y `import-sales-history` trae el historial completo por tandas. No mueven stock.
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
import { isStoreOrder, mapPosOrder, type StockagilePosOrder } from '../_shared/stockagile-sales.ts';

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
  /** Ubicación de Shopify del movimiento (compras); sin ella, la de la tienda. */
  location_gid: string | null;
}

/** Nombre de cada ubicación de Shopify, para buscar el almacén de Stockagile con el mismo. */
async function locationNames(admin: SupabaseClient, businessId: string, gids: string[]) {
  const names = new Map<string, string>();
  for (const gid of [...new Set(gids)]) {
    const { data } = await admin
      .from('shopify_inventory_levels')
      .select('location_name')
      .eq('business_id', businessId)
      .eq('location_gid', gid)
      .not('location_name', 'is', null)
      .limit(1)
      .maybeSingle();
    const name = (data as { location_name?: string | null } | null)?.location_name;
    if (name) names.set(gid, name);
  }
  return names;
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

  // Almacén de cada movimiento: el de su ubicación (compras al almacén) o el de la tienda.
  // Sin almacén no se envía: el movimiento queda como fallido (no aplicado).
  let defaultWarehouse: StockagileWarehouse | null = null;
  let warehouses: StockagileWarehouse[] = [];
  let names = new Map<string, string>();
  try {
    ({ warehouse: defaultWarehouse, warehouses } = await resolveWarehouse(admin, stockagile, businessId));
    names = await locationNames(admin, businessId, moves.map((m) => m.location_gid).filter((g): g is string => !!g));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    for (const m of moves) await finish(m.id, { status: 'failed', last_error: message });
    return { sent, failed: moves.length, review };
  }
  const warehouseFor = (m: MoveRow) =>
    m.location_gid ? pickWarehouse(warehouses, names.get(m.location_gid) ?? null) : defaultWarehouse;

  // Variantes locales; para un producto sin variante se usa el producto (una sola variante en Stockagile).
  const locals = await loadLocalVariants(admin, moves.map((m) => m.local_variant_id).filter((id): id is string => !!id));
  const productIds = moves.filter((m) => !m.local_variant_id && m.local_product_id).map((m) => m.local_product_id as string);
  const { data: productRows } = productIds.length
    ? await admin.from('products').select('id, external_id').in('id', productIds)
    : { data: [] };
  const productGid = new Map(((productRows ?? []) as { id: string; external_id: string | null }[]).map((p) => [p.id, p.external_id]));
  const loadSiteProducts = siteProductsLoader(stockagile);

  for (const m of moves) {
    const warehouse = warehouseFor(m);
    if (!warehouse) {
      await finish(m.id, {
        status: 'failed',
        last_error: m.location_gid
          ? `No hay en Stockagile un almacén llamado «${names.get(m.location_gid) ?? 'esa ubicación'}»`
          : 'No hay en Stockagile un almacén con el nombre de la tienda',
      });
      failed++;
      continue;
    }
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

const SALES_PAGE_SIZE = 100;
const HISTORY_FROM = '2020-01-01T00:00:00Z';

/** Guarda una página de tickets de Stockagile (solo los de la tienda) y rehace sus líneas. */
async function saveSalesPage(admin: SupabaseClient, businessId: string, orders: StockagilePosOrder[]) {
  const store = orders.filter(isStoreOrder);
  if (store.length === 0) return 0;
  const now = new Date().toISOString();
  const mapped = store.map((o) => mapPosOrder(businessId, o, now));
  const { data: saved, error } = await admin
    .from('stockagile_sales')
    .upsert(mapped.map((m) => m.sale), { onConflict: 'business_id,external_id' })
    .select('id, external_id');
  if (error) throw new Error(`No se pudieron guardar las ventas: ${error.message}`);
  const idByExternal = new Map(((saved ?? []) as { id: string; external_id: number }[]).map((r) => [Number(r.external_id), r.id]));
  const ids = [...idByExternal.values()];
  const { error: delError } = await admin.from('stockagile_sale_items').delete().in('sale_id', ids);
  if (delError) throw new Error(`No se pudieron rehacer las líneas: ${delError.message}`);

  // Talla de PYMOVA por el código de barras (si hay una sola con ese código).
  const barcodes = [...new Set(mapped.flatMap((m) => m.items.map((i) => i.barcode)).filter((b): b is string => !!b))];
  const variantByBarcode = new Map<string, string | null>();
  if (barcodes.length) {
    const { data: variants } = await admin
      .from('product_variants').select('id, barcode').eq('business_id', businessId).in('barcode', barcodes);
    for (const v of (variants ?? []) as { id: string; barcode: string }[]) {
      variantByBarcode.set(v.barcode, variantByBarcode.has(v.barcode) ? null : v.id);
    }
  }
  const items = mapped.flatMap((m) => {
    const saleId = idByExternal.get(m.sale.external_id);
    return saleId
      ? m.items.map((i) => ({ ...i, sale_id: saleId, variant_id: i.barcode ? variantByBarcode.get(i.barcode) ?? null : null }))
      : [];
  });
  if (items.length) {
    const { error: insError } = await admin.from('stockagile_sale_items').insert(items);
    if (insError) throw new Error(`No se pudieron guardar las líneas: ${insError.message}`);
  }
  return store.length;
}

/** Tickets de Stockagile creados desde `after`, de la página `page` en adelante (hasta `maxPages`). */
async function importSales(
  admin: SupabaseClient,
  stockagile: StockagileClient,
  businessId: string,
  opts: { after: string; page?: number; maxPages: number },
) {
  let page = opts.page ?? 1;
  let saved = 0;
  let seen = 0;
  let count: number | null = null;
  let done = false;
  for (let i = 0; i < opts.maxPages; i++) {
    const data = await stockagile.get<StockagilePosOrder>('/pos-orders', {
      created_at_after: opts.after,
      page,
      page_size: SALES_PAGE_SIZE,
    });
    count = data.count ?? count;
    seen += data.results.length;
    saved += await saveSalesPage(admin, businessId, data.results);
    if (!data.next) {
      done = true;
      break;
    }
    page++;
  }
  return { saved, seen, count, next_page: done ? null : page, done };
}

/** Los tickets recientes: desde 2 días antes de la última copia (recoge cambios y devoluciones). */
async function syncRecentSales(admin: SupabaseClient, stockagile: StockagileClient, businessId: string) {
  const { data: conn } = await admin
    .from('stockagile_connections').select('sales_synced_at').eq('business_id', businessId).maybeSingle();
  const last = (conn as { sales_synced_at?: string | null } | null)?.sales_synced_at;
  const from = last ? new Date(last).getTime() : Date.now() - 3 * 86_400_000;
  const startedAt = new Date().toISOString();
  const result = await importSales(admin, stockagile, businessId, {
    after: new Date(from - 2 * 86_400_000).toISOString(),
    maxPages: 10,
  });
  if (result.done) {
    await admin.from('stockagile_connections').update({ sales_synced_at: startedAt }).eq('business_id', businessId);
  }
  return result;
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
        const moves = await push(admin, stockagile, c.business_id);
        let sales: unknown;
        try {
          sales = await syncRecentSales(admin, stockagile, c.business_id);
        } catch (error) {
          sales = { error: error instanceof Error ? error.message : 'Error desconocido' };
        }
        results[c.business_id] = { ...moves, sales };
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
    if (action === 'import-sales') {
      // Botón «Actualizar» de las ventas de Stockagile: cualquier miembro del negocio.
      const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
      if (!isMember) return json({ error: 'No tienes acceso a este negocio' }, 403);
      return json({ ok: true, ...(await syncRecentSales(admin, stockagile, businessId)) });
    }
    if (action === 'import-sales-history') {
      // Historial completo por tandas: la pantalla va pidiendo páginas hasta `done`.
      const { data: isAdmin } = await userClient.rpc('has_min_role', { _business_id: businessId, _min_role: 'admin' });
      if (!isAdmin) return json({ error: 'Necesitas permisos de administrador' }, 403);
      const page = Math.max(1, Math.trunc(Number(body.page ?? 1)) || 1);
      const result = await importSales(admin, stockagile, businessId, { after: HISTORY_FROM, page, maxPages: 5 });
      if (result.done) {
        const now = new Date().toISOString();
        await admin
          .from('stockagile_connections')
          .update({ sales_history_imported_at: now })
          .eq('business_id', businessId);
      }
      return json({ ok: true, ...result });
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
