// Alta y actualización de productos de Shopify en Pymova. Lo usan «Forzar
// sincronización» (shopify-sync) y los avisos de producto (cola de webhooks).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { shopifyGraphql } from './shopify-client.ts';
import {
  PRODUCTS_STATUS_QUERY,
  productsGoneFromShopify,
  fetchAllInventoryLevels,
  fetchAllVariants,
  type GraphqlRunner,
  levelRowsNeedingStock,
  variantsToDeactivate,
  variantUnitCost,
  type InventoryLevelRow,
  type LevelPairing,
  type ShopifyProductNode,
  type ShopifyVariantNode,
} from './shopify-core.ts';

export type LevelTotals = { applied: number; stale: number; unknown: number };

/** Aplica niveles de Shopify y recalcula el stock local (tienda + envíos pendientes). */
export async function applyLevels(
  admin: SupabaseClient,
  businessId: string,
  levels: unknown[],
  source: 'shopify' | 'import',
): Promise<LevelTotals> {
  const totals: LevelTotals = { applied: 0, stale: 0, unknown: 0 };
  for (let i = 0; i < levels.length; i += 200) {
    const { data, error } = await admin.rpc('apply_shopify_inventory_levels', {
      _business_id: businessId,
      _levels: levels.slice(i, i + 200),
      _source: source,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as LevelTotals | null;
    totals.applied += row?.applied ?? 0;
    totals.stale += row?.stale ?? 0;
    totals.unknown += row?.unknown ?? 0;
  }
  return totals;
}

export interface UpsertProductOptions {
  /** Usuario que lanza la sincronización; null si viene de un aviso de Shopify. */
  createdBy: string | null;
  /**
   * 'all': pone el stock de todos los artículos («Forzar sincronización»).
   * 'new-items': solo el de los artículos nuevos o reemparejados (avisos de producto).
   */
  stock: 'all' | 'new-items';
  /** Desactiva las variantes locales que ya no existen en Shopify. */
  deactivateMissingVariants?: boolean;
  /** Nombres de ubicación ya leídos (opcional). */
  locations?: Map<string, string>;
}

export interface UpsertProductResult {
  productId: string;
  created: boolean;
  /** Incidencias no fatales, para el registro de la sincronización. */
  issues: Array<{ entity: 'product' | 'inventory'; message: string }>;
}

const run: GraphqlRunner = (q, v, o) => shopifyGraphql(q, v, o);

/** Crea o actualiza en Pymova un producto de Shopify, sus variantes y su inventario. */
export async function upsertShopifyProduct(
  admin: SupabaseClient,
  businessId: string,
  node: ShopifyProductNode,
  opts: UpsertProductOptions,
): Promise<UpsertProductResult> {
  const issues: UpsertProductResult['issues'] = [];

  const { variants, complete } = await fetchAllVariants(run, node);
  if (!complete) {
    issues.push({ entity: 'product', message: 'No se pudieron leer todas las variantes (paginación incompleta).' });
  }

  // Inventario por ubicación de cada variante.
  const inventoryRows: InventoryLevelRow[] = [];
  for (const variant of variants) {
    const { rows } = await fetchAllInventoryLevels(run, variant as ShopifyVariantNode);
    inventoryRows.push(...rows);
  }

  const first = variants[0];
  const firstCost = first ? variantUnitCost(first as ShopifyVariantNode) : null;

  const { data: existing } = await admin
    .from('products')
    .select('id')
    .eq('business_id', businessId)
    .eq('external_source', 'shopify')
    .eq('external_id', node.id)
    .maybeSingle();

  const productPayload = {
    business_id: businessId,
    name: node.title,
    description: node.description || null,
    price: Number(node.priceRangeV2.minVariantPrice.amount) || 0,
    category: node.productType || null,
    sku: first?.sku ?? null,
    barcode: first?.barcode ?? null,
    // Solo sobrescribe el coste si Shopify lo informa (no borra el coste manual).
    ...(firstCost !== null ? { cost_price: firstCost } : {}),
    // El stock no se escribe aquí: lo pone applyLevels con la ubicación de la tienda.
    track_inventory: true,
    is_active: node.status === 'ACTIVE',
    external_id: node.id,
    external_source: 'shopify',
    updated_at: new Date().toISOString(),
  };

  let productId: string;
  let created = false;
  if (existing) {
    const { error } = await admin.from('products').update(productPayload).eq('id', existing.id);
    if (error) throw error;
    productId = existing.id;
  } else {
    const { data: inserted, error } = await admin
      .from('products')
      .insert({ ...productPayload, stock_quantity: 0, created_by: opts.createdBy })
      .select('id')
      .single();
    if (error) throw error;
    productId = inserted.id;
    created = true;
  }

  const localVariantIds = new Map<string, string>();
  if (variants.length > 1) {
    for (const v of variants) {
      const variantCost = variantUnitCost(v as ShopifyVariantNode);
      const variantPayload = {
        business_id: businessId,
        product_id: productId,
        name: v.title,
        attributes: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
        sku: v.sku,
        barcode: v.barcode,
        price: Number(v.price) || null,
        ...(variantCost !== null ? { cost_price: variantCost } : {}),
        is_active: true,
        external_id: v.id,
        external_source: 'shopify',
        updated_at: new Date().toISOString(),
      };

      const { data: existingVariant } = await admin
        .from('product_variants')
        .select('id')
        .eq('business_id', businessId)
        .eq('external_source', 'shopify')
        .eq('external_id', v.id)
        .maybeSingle();

      if (existingVariant) {
        await admin.from('product_variants').update(variantPayload).eq('id', existingVariant.id);
        localVariantIds.set(v.id, existingVariant.id);
      } else {
        const { data: insertedVariant } = await admin
          .from('product_variants')
          .insert({ ...variantPayload, stock_quantity: 0, created_by: opts.createdBy })
          .select('id')
          .maybeSingle();
        if (insertedVariant) localVariantIds.set(v.id, insertedVariant.id);
      }
    }
  }

  // Tallas que ya no existen en Shopify: inactivas, sin borrarlas (tienen ventas).
  if (opts.deactivateMissingVariants && complete) {
    const { data: localVariants } = await admin
      .from('product_variants')
      .select('id, external_id')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('external_source', 'shopify')
      .eq('is_active', true);
    const gone = variantsToDeactivate(
      (localVariants ?? []).map((v) => v.external_id as string).filter(Boolean),
      variants.length > 1 ? variants.map((v) => v.id) : [],
    );
    if (gone.length > 0) {
      await admin
        .from('product_variants')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .eq('external_source', 'shopify')
        .in('external_id', gone);
    }
  }

  if (inventoryRows.length > 0) {
    // Dedup dentro del lote: dos variantes pueden compartir inventory_item.
    let rows = [
      ...new Map(inventoryRows.map((r) => [`${r.inventory_item_gid}|${r.location_gid}`, r])).values(),
    ];
    const pairing = (row: InventoryLevelRow): LevelPairing => ({
      local_product_id: productId,
      local_variant_id: localVariantIds.get(row.variant_external_id) ?? null,
    });

    if (opts.stock === 'new-items') {
      const { data: knownRows, error: knownError } = await admin
        .from('shopify_inventory_levels')
        .select('inventory_item_gid, local_product_id, local_variant_id')
        .eq('business_id', businessId)
        .in('inventory_item_gid', [...new Set(rows.map((r) => r.inventory_item_gid))]);
      if (knownError) throw knownError;
      const known = new Map<string, LevelPairing>(
        (knownRows ?? []).map((r) => [
          r.inventory_item_gid as string,
          { local_product_id: r.local_product_id ?? null, local_variant_id: r.local_variant_id ?? null },
        ]),
      );
      rows = levelRowsNeedingStock(rows, known, pairing);
    }

    if (rows.length > 0) {
      const { error: invError } = await admin.from('shopify_inventory_levels').upsert(
        rows.map((row) => ({
          business_id: businessId,
          variant_external_id: row.variant_external_id,
          ...pairing(row),
          inventory_item_gid: row.inventory_item_gid,
          location_gid: row.location_gid,
          location_name: row.location_name ?? opts.locations?.get(row.location_gid) ?? null,
          available: row.available,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'business_id,inventory_item_gid,location_gid' },
      );
      if (invError) {
        issues.push({
          entity: 'inventory',
          message: `No se pudo guardar el inventario por ubicación: ${invError.message}`,
        });
      } else {
        // Stock local = ubicación de la tienda (+ envíos pendientes).
        await applyLevels(
          admin,
          businessId,
          rows.map((row) => ({
            inventory_item_gid: row.inventory_item_gid,
            location_gid: row.location_gid,
            location_name: row.location_name ?? null,
            available: row.available,
            updated_at: null,
          })),
          'import',
        );
      }
    }
  }

  return { productId, created, issues };
}

/**
 * Tras recorrer todo el catálogo: los productos de Shopify que siguen activos en Pymova
 * pero que esta sincronización no ha tocado (`updated_at` anterior a `since`) se comprueban
 * uno a uno en Shopify; los borrados o no activos se desactivan (no se borran: pueden tener
 * ventas). Devuelve sus nombres.
 */
export async function deactivateProductsGoneFromShopify(
  admin: SupabaseClient,
  businessId: string,
  since: string,
): Promise<string[]> {
  const { data: candidates, error } = await admin
    .from('products')
    .select('id, name, external_id')
    .eq('business_id', businessId)
    .eq('external_source', 'shopify')
    .eq('is_active', true)
    .lt('updated_at', since)
    .not('external_id', 'is', null)
    .limit(500);
  if (error) throw error;
  const rows = (candidates ?? []) as Array<{ id: string; name: string; external_id: string }>;

  const gone: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const data = await shopifyGraphql<{ nodes: Array<{ id?: string; status?: string } | null> }>(
      PRODUCTS_STATUS_QUERY,
      { ids: batch.map((r) => r.external_id) },
      { requiredScopes: ['read_products'] },
    );
    const goneIds = new Set(productsGoneFromShopify(batch.map((r) => r.external_id), data.nodes ?? []));
    gone.push(...batch.filter((r) => goneIds.has(r.external_id)));
  }

  if (gone.length > 0) {
    const { error: updateError } = await admin
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', gone.map((g) => g.id));
    if (updateError) throw updateError;
  }
  return gone.map((g) => g.name);
}
