// Precio de coste de productos y variantes. Solo lo ve quien tiene el permiso «Ver costes»
// (0031), y el servidor lo exige: desde la 0052 la columna de coste no se puede leer con la
// cuenta del usuario y se pide con la RPC `get_catalog_costs`, que comprueba el permiso. Las
// consultas a `products` y `product_variants` usan estas listas de columnas, sin el coste: con
// `select('*')` el servidor responde «permission denied».
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
  return { costs: toCosts(rpc.error ? [] : rpc.data), error: rpc.error };
}
