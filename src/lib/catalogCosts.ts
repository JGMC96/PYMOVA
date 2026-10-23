// Precio de coste de productos y variantes. Solo lo ve quien tiene el permiso «Ver costes»
// (0031), y el servidor lo exige: la app no lee `cost_price` de las tablas, lo pide con la
// RPC `get_catalog_costs`, que comprueba el permiso. Las consultas a `products` y
// `product_variants` usan estas listas de columnas, sin el coste.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from './fetchAllRows';

export const PRODUCT_COLUMNS =
  'id, business_id, name, description, price, unit, category, is_active, stock_quantity, track_inventory, barcode, sku, color, external_id, external_source, created_by, created_at, updated_at';

export const VARIANT_COLUMNS =
  'id, business_id, product_id, name, attributes, sku, barcode, price, stock_quantity, is_active, external_id, external_source, created_by, created_at, updated_at';

export interface CatalogCosts {
  products: Map<string, number>;
  variants: Map<string, number>;
}

type CostRow = { kind: 'product' | 'variant'; id: string; cost_price: number | string | null };

/** La RPC aún no está en la base de datos (llega con la migración de costes ocultos). */
function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883';
}

function toCosts(rows: CostRow[]): CatalogCosts {
  const costs: CatalogCosts = { products: new Map(), variants: new Map() };
  for (const r of rows) {
    if (r.cost_price == null) continue;
    (r.kind === 'product' ? costs.products : costs.variants).set(r.id, Number(r.cost_price));
  }
  return costs;
}

/**
 * Costes del negocio (o de un producto y sus variantes). Llamarla solo con permiso de ver
 * costes: sin él, el servidor responde con error.
 */
export async function fetchCatalogCosts(
  client: SupabaseClient,
  businessId: string,
  productId?: string,
): Promise<{ costs: CatalogCosts; error: unknown }> {
  const rpc = await fetchAllRows<CostRow>((from, to) =>
    client
      .rpc('get_catalog_costs', { _business_id: businessId, _product_id: productId ?? null })
      .range(from, to) as unknown as PromiseLike<{ data: CostRow[] | null; error: unknown }>,
  );
  if (!rpc.error) return { costs: toCosts(rpc.data), error: null };
  if (!isMissingFunction(rpc.error)) return { costs: toCosts([]), error: rpc.error };

  // Hasta que se aplique la migración: lectura directa, como antes.
  const read = (table: 'products' | 'product_variants', kind: CostRow['kind']) =>
    fetchAllRows<CostRow>((from, to) => {
      let q = client
        .from(table)
        .select('id, cost_price')
        .eq('business_id', businessId)
        .not('cost_price', 'is', null);
      if (productId) q = q.eq(table === 'products' ? 'id' : 'product_id', productId);
      return q
        .order('id')
        .range(from, to)
        .then(({ data, error }) => ({
          data: (data as { id: string; cost_price: number | null }[] | null)?.map((r) => ({ ...r, kind })) ?? null,
          error,
        }));
    });
  const [p, v] = await Promise.all([read('products', 'product'), read('product_variants', 'variant')]);
  return { costs: toCosts([...p.data, ...v.data]), error: p.error ?? v.error };
}
