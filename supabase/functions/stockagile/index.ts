// Integración con Stockagile (piloto TUILUS).
// Acción `check` (solo lectura): comprueba el token, encuentra el almacén que corresponde a la
// ubicación de Shopify del TPV y empareja las últimas variantes vendidas con las de Stockagile,
// comparando el stock de los dos lados. No escribe nada ni en Stockagile ni en PYMOVA.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  createStockagileClient,
  normalizeStockagileToken,
  pickSiteProduct,
  pickVariantBySize,
  pickWarehouse,
  sizeLabelsOf,
  StockagileError,
  STOCKAGILE_PILOT_BUSINESS_ID,
  type StockagileClient,
  type StockagileSiteProduct,
  type StockagileVariant,
  type StockagileWarehouse,
} from '../_shared/stockagile-core.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SAMPLE_SIZE = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface SampleVariant {
  id: string;
  name: string | null;
  barcode: string | null;
  sku: string | null;
  attributes: Record<string, unknown> | null;
  stock_quantity: number | null;
  products: { name: string; external_id: string | null } | null;
}

async function check(admin: SupabaseClient, stockagile: StockagileClient, businessId: string) {
  // Ubicación de Shopify del TPV → almacén de Stockagile con el mismo nombre.
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
  const warehouse = pickWarehouse(warehouses, locationName);

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
  const { data: variantRows } = variantIds.length
    ? await admin
        .from('product_variants')
        .select('id, name, barcode, sku, attributes, stock_quantity, products(name, external_id)')
        .in('id', variantIds)
    : { data: [] };
  const variants = (variantRows ?? []) as unknown as SampleVariant[];

  // Productos de la tienda online en Stockagile (para las variantes sin código de barras).
  let siteProducts: StockagileSiteProduct[] | null = null;
  const loadSiteProducts = async () =>
    (siteProducts ??= await stockagile.getAll<StockagileSiteProduct>('/site-product', { page_size: 500 }));

  const matches: {
    variant_id: string;
    product: string;
    size: string | null;
    pymova_stock: number | null;
    matched_by: 'barcode' | 'shopify-product' | null;
    stockagile_variant_id: number | null;
    stockagile_stock: number | null;
    note: string | null;
  }[] = [];

  for (const v of variants) {
    let found: StockagileVariant | null = null;
    let matchedBy: 'barcode' | 'shopify-product' | null = null;
    let note: string | null = null;

    if (v.barcode) {
      const page = await stockagile.get<StockagileVariant>('/product-variants', { barcode: v.barcode });
      const hits = page.results.filter((r) => !r.archived);
      if (hits.length === 1) {
        found = hits[0];
        matchedBy = 'barcode';
      } else if (hits.length > 1) {
        note = `${hits.length} variantes con el mismo código de barras`;
      }
    }
    if (!found) {
      const sp = pickSiteProduct(await loadSiteProducts(), v.products?.external_id);
      if (sp) {
        const page = await stockagile.get<StockagileVariant>('/product-variants', { product_id: sp.product_id, page_size: 100 });
        found = pickVariantBySize(page.results, sizeLabelsOf(v));
        if (found) matchedBy = 'shopify-product';
        else note = note ?? 'Producto encontrado, pero no la talla';
      } else {
        note = note ?? 'El producto de Shopify no está en Stockagile';
      }
    }

    matches.push({
      variant_id: v.id,
      product: v.products?.name ?? '—',
      size: v.name,
      pymova_stock: v.stock_quantity,
      matched_by: matchedBy,
      stockagile_variant_id: found?.id ?? null,
      stockagile_stock: null,
      note,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const businessId = String(body.business_id ?? '');
    if (businessId !== STOCKAGILE_PILOT_BUSINESS_ID) {
      return json({ error: 'Stockagile no está conectado a este negocio' }, 403);
    }
    const { data: isAdmin } = await userClient.rpc('has_min_role', { _business_id: businessId, _min_role: 'admin' });
    if (!isAdmin) return json({ error: 'Necesitas permisos de administrador' }, 403);

    const token = normalizeStockagileToken(Deno.env.get('STOCKAGILE_API_TOKEN'));
    if (!token) return json({ error: 'Falta el secreto STOCKAGILE_API_TOKEN' }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const stockagile = createStockagileClient(fetch, token);

    const action = String(body.action ?? 'check');
    if (action === 'check') return json(await check(admin, stockagile, businessId));
    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (error) {
    const status = error instanceof StockagileError ? 502 : 500;
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('stockagile', message);
    return json({ error: message }, status);
  }
});
