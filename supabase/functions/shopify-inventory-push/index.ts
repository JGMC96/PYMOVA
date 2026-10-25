// Empuja a Shopify los ajustes de stock generados en Pymova (ventas en tienda y devoluciones).
// La cola vive en `shopify_inventory_pushes`; aquí se resuelve la ubicación y se aplica el delta.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getShopDomain, serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';
import { storeConnection } from '../_shared/shopify-connection.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';
import { loadLevelsFor } from '../_shared/shopify-levels.ts';
import { levelPages } from '../_shared/shopify-levels-db.ts';
import { pickPushLevel } from '../_shared/shopify-core.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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

type PushResult =
  | { status: 'ok'; pushed: number; failed: number; skipped: number }
  | { status: 'skipped'; reason: string; pushed: 0 };

/** Aplica en Shopify los envíos de stock pendientes de un negocio (lote de BATCH_SIZE). */
async function pushForBusiness(admin: SupabaseClient, businessId: string): Promise<PushResult> {
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
    .select('id, business_id, local_product_id, local_variant_id, delta, reason, attempts, location_gid, unit_cost')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
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
        .eq('id', row.id);
      failed++;
    }
  }

  return { status: 'ok', pushed, failed, skipped };
}

/** Negocios con envíos de stock pendientes (para las tareas programadas). */
async function businessesWithPendingPushes(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from('shopify_inventory_pushes')
    .select('business_id')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .limit(1000);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.business_id as string))];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const admin = serviceClient();

    // Tareas programadas (pg_cron): sin JWT, con ticket de un solo uso en el cuerpo.
    if (hasTicket(body)) {
      if (!(await consumeTicket(admin, body, 'push-stock'))) return json({ error: 'No autorizado' }, 401);
      const ids = await businessesWithPendingPushes(admin);
      const results = [];
      for (const id of ids) results.push({ business_id: id, ...(await pushForBusiness(admin, id)) });
      return json({ status: 'ok', results });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'Sin acceso a este negocio' }, 403);

    return json(await pushForBusiness(admin, businessId));
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return json({ error: message }, status);
  }
});
