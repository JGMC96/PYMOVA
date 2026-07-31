import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  READ_SCOPES,
  SHOPIFY_API_VERSION,
  ShopifyError,
  getShopDomain,
  shopifyGraphql,
  verifyConnection,
} from '../_shared/shopify-client.ts';
import {
  CUSTOMERS_QUERY,
  LOCATIONS_QUERY,
  PRODUCTS_QUERY,
  fetchAllInventoryLevels,
  fetchAllVariants,
  resolveClientMatch,
  totalAvailable,
  type InventoryLevelRow,
  type ShopifyProductNode,
  type ShopifyVariantNode,
} from '../_shared/shopify-core.ts';
import { drainWebhookQueue, syncFulfillmentsForOrder } from '../_shared/shopify-webhooks.ts';
import { ORDERS_QUERY, buildUpsertArgs, type ShopifyAdminOrder } from '../_shared/shopify-admin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const run = <T,>(query: string, variables: Record<string, unknown>, scopes: string[]) =>
  shopifyGraphql<T>(query, variables, { requiredScopes: scopes });

/** Forma que consume el frontend (catálogo navegable). */
function toClientProduct(node: ShopifyProductNode, stockByVariant: Map<string, number | null>) {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: node.description,
    productType: node.productType,
    vendor: node.vendor,
    status: node.status,
    featuredImage: node.featuredImage,
    priceRange: { minVariantPrice: node.priceRangeV2.minVariantPrice },
    variants: {
      edges: node.variants.edges.map(({ node: v }) => ({
        node: {
          id: v.id,
          title: v.title,
          sku: v.sku,
          barcode: v.barcode,
          availableForSale: v.availableForSale,
          quantityAvailable: stockByVariant.get(v.id) ?? null,
          price: {
            amount: v.price,
            currencyCode: node.priceRangeV2.minVariantPrice.currencyCode,
          },
          selectedOptions: v.selectedOptions,
        },
      })),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'status');
    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    // --- Aislamiento entre organizaciones ---
    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'No tienes acceso a este negocio' }, 403);

    const requiresAdmin = ['verify', 'sync', 'claim', 'process-webhooks'].includes(action);
    if (requiresAdmin) {
      const { data: isAdmin } = await userClient.rpc('has_min_role', {
        _business_id: businessId,
        _min_role: 'admin',
      });
      if (!isAdmin && !isSuper) {
        return json({ error: 'Necesitas permisos de administrador' }, 403);
      }
    }

    const shop = getShopDomain();

    /** La tienda pertenece a un único negocio: sin vínculo no se toca Shopify. */
    const loadConnection = async () => {
      const { data: byShop } = await admin
        .from('shopify_connections')
        .select('*')
        .eq('shop_domain', shop)
        .maybeSingle();
      return byShop ?? null;
    };

    const requireConnection = async () => {
      const connection = await loadConnection();
      if (!connection) {
        throw new ShopifyError(
          'Esta tienda de Shopify todavía no está vinculada a ningún negocio. Vincúlala antes de sincronizar.',
          409,
        );
      }
      if (connection.business_id !== businessId) {
        throw new ShopifyError('Esta tienda de Shopify pertenece a otro negocio.', 403);
      }
      if (connection.uninstalled_at) {
        throw new ShopifyError('La aplicación ha sido desinstalada de esta tienda.', 409);
      }
      return connection;
    };

    const patchConnection = async (patch: Record<string, unknown>) => {
      await admin
        .from('shopify_connections')
        .update({ ...patch, api_version: SHOPIFY_API_VERSION })
        .eq('business_id', businessId)
        .eq('shop_domain', shop);
    };

    const loadStats = async () => {
      const [products, variants, orders, clients, issues, levels, fulfillments] = await Promise.all([
        admin.from('products').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('external_source', 'shopify'),
        admin.from('product_variants').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('external_source', 'shopify'),
        admin.from('online_orders').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('source', 'shopify'),
        admin.from('clients').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('external_source', 'shopify'),
        admin.from('integration_sync_issues').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('resolved', false),
        admin.from('shopify_inventory_levels').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId),
        admin.from('shopify_fulfillments').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId),
      ]);
      return {
        products: products.count ?? 0,
        variants: variants.count ?? 0,
        orders: orders.count ?? 0,
        clients: clients.count ?? 0,
        open_issues: issues.count ?? 0,
        inventory_levels: levels.count ?? 0,
        fulfillments: fulfillments.count ?? 0,
      };
    };

    // ---------------------------------------------------------------- status
    if (action === 'status') {
      const connection = await loadConnection();
      const ownedByOther = !!connection && connection.business_id !== businessId;

      const { count: pendingWebhooks } = await admin
        .from('integration_webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('integration_key', 'shopify')
        .eq('business_id', businessId)
        .in('status', ['pending', 'retrying']);

      return json({
        shop_domain: shop,
        api_version: SHOPIFY_API_VERSION,
        required_scopes: READ_SCOPES,
        claimed: !!connection && !ownedByOther,
        owned_by_other_business: ownedByOther,
        connection: ownedByOther ? null : connection,
        pending_webhooks: pendingWebhooks ?? 0,
        stats: await loadStats(),
      });
    }

    // ----------------------------------------------------------------- claim
    if (action === 'claim') {
      const { error } = await userClient.rpc('claim_shopify_shop', {
        _business_id: businessId,
        _shop_domain: shop,
        _api_version: SHOPIFY_API_VERSION,
      });
      if (error) return json({ error: error.message }, 403);
      return json({ ok: true, shop_domain: shop });
    }

    // ---------------------------------------------------------------- verify
    if (action === 'verify') {
      await requireConnection();
      const result = await verifyConnection();
      await patchConnection({
        last_verified_at: new Date().toISOString(),
        granted_scopes: result.scopes,
        uninstalled_at: null,
      });
      return json({
        ok: true,
        shop_domain: result.shop,
        shop_name: result.name,
        scopes: result.scopes,
        missing: READ_SCOPES.filter((s) => !result.scopes.includes(s)),
      });
    }

    // ------------------------------------------------------- process-webhooks
    if (action === 'process-webhooks') {
      await requireConnection();
      const handled = await drainWebhookQueue(admin, Number(body.limit ?? 20));
      return json({ ok: true, handled });
    }

    // --------------------------------------------------------- list-products
    if (action === 'list-products') {
      await requireConnection();
      const data = await run<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyProductNode }>;
        };
      }>(
        PRODUCTS_QUERY,
        {
          first: Math.min(Number(body.first ?? 50), 100),
          after: body.after ?? null,
          query: body.query ? String(body.query) : null,
        },
        ['read_products'],
      );

      const stockByVariant = new Map<string, number | null>();
      for (const { node } of data.products.edges) {
        for (const { node: v } of node.variants.edges) {
          const rows = v.inventoryItem
            ? v.inventoryItem.inventoryLevels.edges.map((e) => ({
                variant_external_id: v.id,
                inventory_item_gid: v.inventoryItem!.id,
                location_gid: e.node.location.id,
                location_name: e.node.location.name,
                available: e.node.quantities.find((q) => q.name === 'available')?.quantity ?? 0,
              }))
            : [];
          stockByVariant.set(v.id, rows.length ? totalAvailable(rows) : null);
        }
      }

      return json({
        products: data.products.edges.map((e) => toClientProduct(e.node, stockByVariant)),
        hasNextPage: data.products.pageInfo.hasNextPage,
        endCursor: data.products.pageInfo.endCursor,
      });
    }

    // ------------------------------------------------------------------ sync
    if (action === 'sync') {
      await requireConnection();
      const scopeOption = String(body.scope ?? 'all');
      const days = Number(body.days ?? 60);

      const { data: syncRun } = await admin
        .from('integration_sync_runs')
        .insert({
          business_id: businessId,
          integration_key: 'shopify',
          scope: scopeOption,
          status: 'running',
          created_by: userData.user.id,
        })
        .select('id')
        .single();

      let created = 0;
      let updated = 0;
      let failed = 0;
      const messages: string[] = [];

      const logIssue = async (
        entityType: string,
        entityName: string,
        externalId: string | null,
        message: string,
      ) => {
        failed += 1;
        if (!syncRun) return;
        await admin.from('integration_sync_issues').insert({
          business_id: businessId,
          run_id: syncRun.id,
          entity_type: entityType,
          entity_name: entityName,
          external_id: externalId,
          attempts: 1,
          error_message: message.slice(0, 500),
        });
      };

      try {
        // --- Ubicaciones ---
        const locations = new Map<string, string>();
        try {
          const data = await run<{
            locations: { edges: Array<{ node: { id: string; name: string; isActive: boolean } }> };
          }>(LOCATIONS_QUERY, {}, ['read_locations']);
          for (const { node } of data.locations.edges) locations.set(node.id, node.name);
        } catch (err) {
          messages.push(err instanceof Error ? err.message : 'Error al leer ubicaciones');
        }

        // --- Catálogo: productos, variantes (paginadas) e inventario por ubicación ---
        if (scopeOption === 'all' || scopeOption === 'catalog') {
          let cursor: string | null = null;
          for (let page = 0; page < 50; page++) {
            const data: {
              products: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{ node: ShopifyProductNode }>;
              };
            } = await run(PRODUCTS_QUERY, { first: 50, after: cursor, query: null }, [
              'read_products',
            ]);

            for (const { node } of data.products.edges) {
              try {
                const { variants, complete } = await fetchAllVariants(
                  (q, v, o) => shopifyGraphql(q, v, o),
                  node,
                );
                if (!complete) {
                  await logIssue(
                    'product',
                    node.title,
                    node.id,
                    'No se pudieron leer todas las variantes (paginación incompleta).',
                  );
                }

                // Inventario por ubicación de cada variante.
                const inventoryRows: InventoryLevelRow[] = [];
                const perVariantStock = new Map<string, number>();
                for (const variant of variants) {
                  const { rows } = await fetchAllInventoryLevels(
                    (q, v, o) => shopifyGraphql(q, v, o),
                    variant as ShopifyVariantNode,
                  );
                  inventoryRows.push(...rows);
                  perVariantStock.set(variant.id, totalAvailable(rows));
                }

                const first = variants[0];
                const productStock = [...perVariantStock.values()].reduce((a, b) => a + b, 0);

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
                  stock_quantity: productStock,
                  track_inventory: true,
                  is_active: node.status === 'ACTIVE',
                  external_id: node.id,
                  external_source: 'shopify',
                  updated_at: new Date().toISOString(),
                };

                let productId: string;
                if (existing) {
                  await admin.from('products').update(productPayload).eq('id', existing.id);
                  productId = existing.id;
                  updated += 1;
                } else {
                  const { data: inserted, error } = await admin
                    .from('products')
                    .insert({ ...productPayload, created_by: userData.user.id })
                    .select('id')
                    .single();
                  if (error) throw error;
                  productId = inserted.id;
                  created += 1;
                }

                const localVariantIds = new Map<string, string>();
                if (variants.length > 1) {
                  for (const v of variants) {
                    const variantPayload = {
                      business_id: businessId,
                      product_id: productId,
                      name: v.title,
                      attributes: Object.fromEntries(
                        v.selectedOptions.map((o) => [o.name, o.value]),
                      ),
                      sku: v.sku,
                      barcode: v.barcode,
                      price: Number(v.price) || null,
                      stock_quantity: perVariantStock.get(v.id) ?? 0,
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
                      await admin
                        .from('product_variants')
                        .update(variantPayload)
                        .eq('id', existingVariant.id);
                      localVariantIds.set(v.id, existingVariant.id);
                    } else {
                      const { data: insertedVariant } = await admin
                        .from('product_variants')
                        .insert({ ...variantPayload, created_by: userData.user.id })
                        .select('id')
                        .maybeSingle();
                      if (insertedVariant) localVariantIds.set(v.id, insertedVariant.id);
                    }
                  }
                }

                if (inventoryRows.length > 0) {
                  await admin.from('shopify_inventory_levels').upsert(
                    inventoryRows.map((row) => ({
                      business_id: businessId,
                      variant_external_id: row.variant_external_id,
                      local_variant_id: localVariantIds.get(row.variant_external_id) ?? null,
                      local_product_id: productId,
                      inventory_item_gid: row.inventory_item_gid,
                      location_gid: row.location_gid,
                      location_name: row.location_name ?? locations.get(row.location_gid) ?? null,
                      available: row.available,
                      synced_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })),
                    { onConflict: 'business_id,inventory_item_gid,location_gid' },
                  );
                }
              } catch (err) {
                await logIssue(
                  'product',
                  node.title,
                  node.id,
                  err instanceof Error ? err.message : 'Error desconocido',
                );
              }
            }

            if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
            cursor = data.products.pageInfo.endCursor;
          }
        }

        // --- Pedidos, líneas y envíos ---
        if (scopeOption === 'all' || scopeOption === 'orders') {
          const since = new Date(Date.now() - days * 86400000).toISOString();
          let cursor: string | null = null;
          for (let page = 0; page < 20; page++) {
            const data: {
              orders: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{ node: ShopifyAdminOrder }>;
              };
            } = await run(
              ORDERS_QUERY,
              { first: 50, after: cursor, query: `updated_at:>='${since}'` },
              ['read_orders'],
            );

            for (const { node } of data.orders.edges) {
              try {
                const { data: result, error } = await admin.rpc(
                  'upsert_external_order',
                  buildUpsertArgs(businessId, node) as never,
                );
                if (error) throw error;
                const row = Array.isArray(result) ? result[0] : result;
                if (row?.was_created) created += 1;
                else updated += 1;
                if (row?.order_id) {
                  await admin
                    .from('online_orders')
                    .update({ stock_applied: true })
                    .eq('id', row.order_id);
                  await syncFulfillmentsForOrder(admin, businessId, row.order_id, node);
                }
              } catch (err) {
                await logIssue('order', node.name, node.id, err instanceof Error ? err.message : 'Error');
              }
            }

            if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
            cursor = data.orders.pageInfo.endCursor;
          }
        }

        // --- Clientes (identificados por GID, nunca fusionados por email) ---
        if (scopeOption === 'all' || scopeOption === 'customers') {
          let cursor: string | null = null;
          for (let page = 0; page < 20; page++) {
            const data: {
              customers: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{
                  node: {
                    id: string;
                    firstName: string | null;
                    lastName: string | null;
                    email: string | null;
                    phone: string | null;
                    note: string | null;
                  };
                }>;
              };
            } = await run(CUSTOMERS_QUERY, { first: 50, after: cursor }, ['read_customers']);

            for (const { node } of data.customers.edges) {
              const name =
                [node.firstName, node.lastName].filter(Boolean).join(' ').trim() ||
                node.email ||
                'Cliente Shopify';
              try {
                const filters = [`external_id.eq.${node.id}`];
                if (node.email) filters.push(`email.ilike.${node.email.replace(/[,;()]/g, '')}`);
                const { data: candidates } = await admin
                  .from('clients')
                  .select('id, external_id, email')
                  .eq('business_id', businessId)
                  .or(filters.join(','))
                  .limit(20);

                const match = resolveClientMatch(node.id, node.email, candidates ?? []);
                const payload = {
                  name,
                  email: node.email,
                  phone: node.phone,
                  external_id: node.id,
                  external_source: 'shopify',
                  updated_at: new Date().toISOString(),
                };

                if (match.action === 'update') {
                  await admin.from('clients').update(payload).eq('id', match.id);
                  updated += 1;
                } else {
                  const { error } = await admin.from('clients').insert({
                    business_id: businessId,
                    notes: node.note,
                    created_by: userData.user.id,
                    ...payload,
                  });
                  if (error) throw error;
                  created += 1;
                }
              } catch (err) {
                await logIssue('customer', name, node.id, err instanceof Error ? err.message : 'Error');
              }
            }

            if (!data.customers.pageInfo.hasNextPage || !data.customers.pageInfo.endCursor) break;
            cursor = data.customers.pageInfo.endCursor;
          }
        }

        const status = failed > 0 ? 'partial' : 'success';
        const summaryMessage = [
          `${created} nuevos · ${updated} actualizados`,
          failed > 0 ? `${failed} con error` : null,
          locations.size ? `${locations.size} ubicaciones` : null,
          ...messages,
        ]
          .filter(Boolean)
          .join(' · ');

        if (syncRun) {
          await admin
            .from('integration_sync_runs')
            .update({
              status,
              created_count: created,
              updated_count: updated,
              failed_count: failed,
              finished_at: new Date().toISOString(),
              message: summaryMessage,
            })
            .eq('id', syncRun.id);
        }

        const now = new Date().toISOString();
        await patchConnection({
          last_sync_status: status,
          last_sync_error: null,
          ...(scopeOption === 'all' || scopeOption === 'catalog'
            ? { last_catalog_sync_at: now }
            : {}),
          ...(scopeOption === 'all' || scopeOption === 'orders' ? { last_orders_sync_at: now } : {}),
          last_verified_at: now,
        });

        return json({
          ok: true,
          created,
          updated,
          failed,
          message: summaryMessage,
          stats: await loadStats(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        if (syncRun) {
          await admin
            .from('integration_sync_runs')
            .update({
              status: 'error',
              created_count: created,
              updated_count: updated,
              failed_count: failed,
              finished_at: new Date().toISOString(),
              message,
            })
            .eq('id', syncRun.id);
        }
        await patchConnection({ last_sync_status: 'error', last_sync_error: message });
        return json({ error: message }, err instanceof ShopifyError ? err.status : 500);
      }
    }

    return json({ error: 'Acción no soportada' }, 400);
  } catch (err) {
    if (err instanceof ShopifyError) {
      return json({ error: err.message, missing_scopes: err.missingScopes }, err.status);
    }
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('shopify-sync error:', message);
    return json({ error: message }, 500);
  }
});
