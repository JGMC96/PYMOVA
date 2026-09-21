// Empuja a Shopify los ajustes de stock generados en Pymova (ventas en tienda y devoluciones).
// La cola vive en `shopify_inventory_pushes`; aquí se resuelve la ubicación y se aplica el delta.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';

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
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt reason }
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
}

interface LevelRow {
  inventory_item_gid: string;
  location_gid: string;
  available: number;
  local_variant_id: string | null;
  local_product_id: string | null;
}

/** Elige la ubicación del negocio para la variante/producto indicado. */
function pickLevel(levels: LevelRow[], row: PushRow, preferred: string | null): LevelRow | null {
  const matches = levels.filter((l) =>
    row.local_variant_id
      ? l.local_variant_id === row.local_variant_id
      : !!row.local_product_id && l.local_product_id === row.local_product_id,
  );
  if (matches.length === 0) return null;
  if (preferred) {
    const atPreferred = matches.find((l) => l.location_gid === preferred);
    if (atPreferred) return atPreferred;
  }
  // Sin ubicación preferida: la que más stock tenga, para no dejar negativos.
  return matches.sort((a, b) => b.available - a.available)[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'Sin acceso a este negocio' }, 403);

    const admin = serviceClient();

    const { data: connection } = await admin
      .from('shopify_connections')
      .select('shop_domain, default_location_gid')
      .eq('business_id', businessId)
      .maybeSingle();

    if (!connection) {
      return json({ status: 'skipped', reason: 'Sin tienda de Shopify vinculada', pushed: 0 });
    }

    const { data: pending } = await admin
      .from('shopify_inventory_pushes')
      .select('id, business_id, local_product_id, local_variant_id, delta, reason, attempts')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .lt('attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    const rows = (pending ?? []) as PushRow[];
    if (rows.length === 0) return json({ status: 'ok', pushed: 0, failed: 0, skipped: 0 });

    const { data: levelData } = await admin
      .from('shopify_inventory_levels')
      .select('inventory_item_gid, location_gid, available, local_variant_id, local_product_id')
      .eq('business_id', businessId);
    const levels = (levelData ?? []) as LevelRow[];

    const preferred = (connection as { default_location_gid?: string | null }).default_location_gid ?? null;

    let pushed = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const level = pickLevel(levels, row, preferred);

      if (!level) {
        await admin
          .from('shopify_inventory_pushes')
          .update({
            status: 'skipped',
            last_error: 'El producto no está emparejado con ninguna variante de Shopify',
            processed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        skipped++;
        continue;
      }

      try {
        const result = await shopifyGraphql<{
          inventoryAdjustQuantities: { userErrors: { message: string }[] } | null;
        }>(
          ADJUST_MUTATION,
          {
            input: {
              reason: 'correction',
              name: 'available',
              referenceDocumentUri: `pymova://${row.reason}/${row.id}`,
              changes: [
                {
                  delta: row.delta,
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

        const nextAvailable = level.available + row.delta;
        level.available = nextAvailable;

        await admin
          .from('shopify_inventory_levels')
          .update({ available: nextAvailable, synced_at: new Date().toISOString() })
          .eq('business_id', businessId)
          .eq('inventory_item_gid', level.inventory_item_gid)
          .eq('location_gid', level.location_gid);

        await admin
          .from('shopify_inventory_pushes')
          .update({
            status: 'done',
            attempts: row.attempts + 1,
            inventory_item_gid: level.inventory_item_gid,
            location_gid: level.location_gid,
            last_error: null,
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

    return json({ status: 'ok', pushed, failed, skipped });
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return json({ error: message }, status);
  }
});
