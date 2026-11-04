// Envía a Shopify los ajustes de stock de la cola `shopify_inventory_pushes` (ventas en tienda,
// devoluciones y compras): resuelve la ubicación y aplica el delta. Lo usan shopify-inventory-push,
// shopify-pos-order y stockagile: con Stockagile conectado, este envío tiene que llegar a Shopify
// antes que el pedido o el movimiento, porque Stockagile copia su cifra y, si llega después, resta
// o suma dos veces.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getShopDomain, shopifyGraphql, ShopifyError } from './shopify-client.ts';
import { storeConnection } from './shopify-connection.ts';
import { loadLevelsFor } from './shopify-levels.ts';
import { levelPages } from './shopify-levels-db.ts';
import { pickPushLevel, pushesStillOwed, pushInFlight, type QueuedPush } from './shopify-core.ts';

export const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

const ADJUST_MUTATION = `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!, $key: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
      inventoryAdjustmentGroup { createdAt reason }
      userErrors { field message }
    }
  }
`;

const COST_MUTATION = `
  mutation UpdateCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id }
      userErrors { field message }
    }
  }
`;

interface PushRow {
  id: string;
  updated_at: string;
  business_id: string;
  local_product_id: string | null;
  local_variant_id: string | null;
  delta: number;
  reason: string;
  attempts: number;
  /** Ubicación de destino (compras); sin ella, la de la tienda. */
  location_gid: string | null;
  /** Coste por unidad que se apunta en Shopify (compras). */
  unit_cost: number | null;
}

interface LevelRow {
  id: string;
  inventory_item_gid: string;
  location_gid: string;
  available: number;
  local_variant_id: string | null;
  local_product_id: string | null;
}

export type PushResult =
  | { status: 'ok'; pushed: number; failed: number; skipped: number }
  | { status: 'skipped'; reason: string; pushed: 0 };

/** Aplica en Shopify los envíos de stock pendientes de un negocio (lote de BATCH_SIZE). */
export async function pushForBusiness(admin: SupabaseClient, businessId: string): Promise<PushResult> {
  // Solo la conexión de la tienda de este despliegue (S1): un dominio cualquiera no basta.
  const connection = await storeConnection<{
    shop_domain: string;
    default_location_gid: string | null;
    stock_push_enabled: boolean;
  }>(admin, businessId, getShopDomain(), 'shop_domain, default_location_gid, stock_push_enabled');

  if (!connection) {
    return { status: 'skipped', reason: 'Sin tienda de Shopify vinculada', pushed: 0 };
  }
  if ((connection as { stock_push_enabled?: boolean }).stock_push_enabled === false) {
    return { status: 'skipped', reason: 'Envío de stock desactivado', pushed: 0 };
  }

  const { data: pending } = await admin
    .from('shopify_inventory_pushes')
    .select('id, updated_at, business_id, local_product_id, local_variant_id, delta, reason, attempts, location_gid, unit_cost')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  const rows = (pending ?? []) as PushRow[];
  if (rows.length === 0) return { status: 'ok', pushed: 0, failed: 0, skipped: 0 };

  // Solo los emparejamientos de este lote (la tabla entera pasa de las 1.000 filas).
  const levels = await loadLevelsFor<LevelRow>(
    levelPages(admin, businessId, 'inventory_item_gid, location_gid, available, local_variant_id, local_product_id'),
    {
      variantIds: rows.map((r) => r.local_variant_id),
      productIds: rows.filter((r) => !r.local_variant_id).map((r) => r.local_product_id),
    },
  );

  const preferred = (connection as { default_location_gid?: string | null }).default_location_gid ?? null;

  let pushed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    // Otra ejecución lo está enviando (o se cortó hace poco): se deja para la siguiente.
    if (pushInFlight(row, Date.now())) continue;

    // Se cortó en su último intento: ya no se reintenta solo.
    if (row.attempts >= MAX_ATTEMPTS) {
      await admin
        .from('shopify_inventory_pushes')
        .update({ status: 'failed', last_error: 'El envío no terminó: compruébalo en Shopify antes de reintentar.' })
        .eq('id', row.id)
        .eq('status', 'pending');
      failed++;
      continue;
    }

    const level = pickPushLevel(levels, row, preferred);

    if (!level) {
      await admin
        .from('shopify_inventory_pushes')
        .update({
          status: 'skipped',
          last_error: row.location_gid
            ? 'El artículo no está en esa ubicación de Shopify: actívalo allí y vuelve a enviarlo'
            : 'El producto no está emparejado con ninguna variante de Shopify',
          processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      skipped++;
      continue;
    }

    // Se reclama antes de enviarlo: varias funciones envían la cola a la vez y solo una puede
    // aplicar cada envío. La fila sigue en 'pending', y recompute_local_stock la sigue contando.
    const { data: claimed, error: claimError } = await admin
      .from('shopify_inventory_pushes')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('attempts', row.attempts)
      .select('id');
    if (claimError || !claimed?.length) continue;

    try {
      // Shopify (2026-07+) exige changeFromQuantity: leemos la cantidad real actual.
      const current = await shopifyGraphql<{
        inventoryItem: { inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null;
      }>(
        `query Q($id: ID!, $loc: ID!) { inventoryItem(id: $id) { inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } }`,
        { id: level.inventory_item_gid, loc: level.location_gid },
        { requiredScopes: ['write_inventory'] },
      );
      const liveQty =
        current.inventoryItem?.inventoryLevel?.quantities?.find((q) => q.name === 'available')?.quantity ??
        level.available;

      const result = await shopifyGraphql<{
        inventoryAdjustQuantities: { userErrors: { message: string }[] } | null;
      }>(
        ADJUST_MUTATION,
        {
          key: row.id,
          input: {
            reason: 'correction',
            name: 'available',
            referenceDocumentUri: `pymova://${row.reason}/${row.id}`,
            changes: [
              {
                delta: row.delta,
                changeFromQuantity: liveQty,
                inventoryItemId: level.inventory_item_gid,
                locationId: level.location_gid,
              },
            ],
          },
        },
        { requiredScopes: ['write_inventory'] },
      );

      const errors = result.inventoryAdjustQuantities?.userErrors ?? [];
      if (errors.length > 0) throw new ShopifyError(errors.map((e) => e.message).join('; '), 422);

      const nextAvailable = liveQty + row.delta;
      level.available = nextAvailable;

      await admin
        .from('shopify_inventory_levels')
        .update({ available: nextAvailable, synced_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('inventory_item_gid', level.inventory_item_gid)
        .eq('location_gid', level.location_gid);

      // Compras: el coste pasa a ser el de la última compra. Si falla, el stock ya está
      // enviado; se apunta el aviso sin repetir el envío.
      let costError: string | null = null;
      if (row.unit_cost != null && Number(row.unit_cost) > 0) {
        try {
          const cost = await shopifyGraphql<{ inventoryItemUpdate: { userErrors: { message: string }[] } | null }>(
            COST_MUTATION,
            { id: level.inventory_item_gid, input: { cost: Number(row.unit_cost) } },
            { requiredScopes: ['write_inventory'] },
          );
          const costErrors = cost.inventoryItemUpdate?.userErrors ?? [];
          if (costErrors.length > 0) costError = costErrors.map((e) => e.message).join('; ');
        } catch (e) {
          costError = e instanceof Error ? e.message : 'Error desconocido';
        }
      }

      await admin
        .from('shopify_inventory_pushes')
        .update({
          status: 'done',
          attempts: row.attempts + 1,
          inventory_item_gid: level.inventory_item_gid,
          location_gid: level.location_gid,
          last_error: costError ? `Stock enviado; el coste no se pudo apuntar: ${costError}` : null,
          processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      pushed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      const attempts = row.attempts + 1;
      await admin
        .from('shopify_inventory_pushes')
        .update({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          last_error: message,
          inventory_item_gid: level.inventory_item_gid,
          location_gid: level.location_gid,
        })
        .eq('id', row.id)
        // Nunca pisa un envío que otra ejecución ya terminó.
        .eq('status', 'pending');
      failed++;
    }
  }

  return { status: 'ok', pushed, failed, skipped };
}

/**
 * Manda a Shopify la cola de stock y devuelve las líneas (`source_id`) cuyo envío aún no ha
 * llegado: su pedido o su movimiento a Stockagile tienen que esperar. Sin envío de stock (sin
 * tienda o desactivado) no se espera a nada; si no se puede saber, se espera por todas.
 */
export async function flushStockPushes(
  admin: SupabaseClient,
  businessId: string,
  sourceIds: string[],
): Promise<Set<string>> {
  try {
    const result = await pushForBusiness(admin, businessId);
    if (result.status === 'skipped') return new Set();
  } catch (error) {
    console.error('No se pudo enviar el stock a Shopify', error instanceof Error ? error.message : error);
  }
  if (sourceIds.length === 0) return new Set();
  const { data, error } = await admin
    .from('shopify_inventory_pushes')
    .select('source_id, status')
    .eq('business_id', businessId)
    .in('source_id', sourceIds);
  if (error) {
    console.error('No se pudo leer la cola de stock', error.message);
    return new Set(sourceIds);
  }
  return pushesStillOwed((data ?? []) as QueuedPush[]);
}
