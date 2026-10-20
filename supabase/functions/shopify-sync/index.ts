import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
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
  missingScopes,
  resolveClientMatch,
  availableAtLocation,
  INVENTORY_ITEMS_BATCH,
  INVENTORY_ITEMS_LEVELS_QUERY,
  levelsFromInventoryItemNodes,
  type InventoryItemLevelsNode,
  type ShopifyProductNode,
} from '../_shared/shopify-core.ts';
import { drainWebhookQueue, syncFulfillmentsForOrder } from '../_shared/shopify-webhooks.ts';
import { ORDERS_QUERY, buildUpsertArgs, type ShopifyAdminOrder } from '../_shared/shopify-admin.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';
import { applyLevels, upsertShopifyProduct, type LevelTotals } from '../_shared/shopify-catalog.ts';

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

/** Texto legible de cualquier error (Error, PostgrestError o desconocido). */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return 'Error desconocido';
    }
  }
  return String(err ?? 'Error desconocido');
}


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

/**
 * Lee de Shopify el disponible actual de todos los artículos emparejados y pone el
 * stock local al día (ubicación de la tienda + envíos pendientes). Deja la hora y el
 * resultado en shopify_connections para verlo en la integración.
 */
async function refreshStock(admin: SupabaseClient, businessId: string) {
  const record = (status: string) =>
    admin
      .from('shopify_connections')
      .update({ last_stock_refresh_at: new Date().toISOString(), last_stock_refresh_status: status })
      .eq('business_id', businessId);

  try {
    const items = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('shopify_inventory_levels')
        .select('inventory_item_gid')
        .eq('business_id', businessId)
        .order('inventory_item_gid')
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data ?? []) items.add(row.inventory_item_gid);
      if (!data || data.length < 1000) break;
    }

    const ids = [...items];
    let read = 0;
    const totals: LevelTotals = { applied: 0, stale: 0, unknown: 0 };
    for (let i = 0; i < ids.length; i += INVENTORY_ITEMS_BATCH) {
      const data = await run<{ nodes: Array<InventoryItemLevelsNode | null> }>(
        INVENTORY_ITEMS_LEVELS_QUERY,
        { ids: ids.slice(i, i + INVENTORY_ITEMS_BATCH) },
        ['read_inventory'],
      );
      const levels = levelsFromInventoryItemNodes(data.nodes ?? []);
      read += levels.length;
      if (levels.length === 0) continue;
      const r = await applyLevels(admin, businessId, levels, 'import');
      totals.applied += r.applied;
      totals.stale += r.stale;
      totals.unknown += r.unknown;
    }

    await record(`ok: ${ids.length} artículos, ${totals.applied} niveles aplicados`);
    return { items: ids.length, levels: read, ...totals };
  } catch (error) {
    await record(`error: ${errorText(error)}`.slice(0, 500));
    throw error;
  }
}

/**
 * Tareas programadas (pg_cron con un ticket de un solo uso): solo procesar la cola de
 * avisos y refrescar el stock. El negocio sale de la conexión de la tienda.
 */
async function handleScheduledJob(admin: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const action = String(body.action ?? '');
  if (!['process-webhooks', 'refresh-stock'].includes(action)) {
    return json({ error: 'Acción no permitida para tareas programadas' }, 403);
  }
  if (!(await consumeTicket(admin, body, action))) return json({ error: 'No autorizado' }, 401);
  try {
    if (action === 'process-webhooks') {
      const handled = await drainWebhookQueue(admin, Math.min(Number(body.limit ?? 50), 100));
      return json({ ok: true, handled });
    }
    if (action === 'refresh-stock') {
      const { data: connection } = await admin
        .from('shopify_connections')
        .select('business_id, uninstalled_at')
        .eq('shop_domain', getShopDomain())
        .maybeSingle();
      if (!connection || connection.uninstalled_at) {
        return json({ ok: true, skipped: 'Sin tienda de Shopify vinculada' });
      }
      return json({ ok: true, ...(await refreshStock(admin, connection.business_id)) });
    }
    return json({ error: 'Acción no permitida para tareas programadas' }, 403);
  } catch (error) {
    return json({ error: errorText(error) }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};

    // Tareas programadas: sin JWT, con ticket de un solo uso en el cuerpo.
    if (hasTicket(body)) return await handleScheduledJob(admin, body);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const action = String(body.action ?? 'status');
    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    // --- Aislamiento entre organizaciones ---
    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'No tienes acceso a este negocio' }, 403);

    const requiresAdmin = ['verify', 'sync', 'claim', 'process-webhooks', 'refresh-stock'].includes(action);
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
        missing: missingScopes(result.scopes, READ_SCOPES),
        can_push_stock: result.scopes.includes('write_inventory'),
      });
    }

    // ------------------------------------------------------- process-webhooks
    if (action === 'process-webhooks') {
      await requireConnection();
      const handled = await drainWebhookQueue(admin, Number(body.limit ?? 20));
      return json({ ok: true, handled });
    }

    // ---------------------------------------------------------- refresh-stock
    // Lee de Shopify el disponible actual de todos los artículos emparejados y
    // pone el stock local al día (ubicación de la tienda + envíos pendientes).
    if (action === 'refresh-stock') {
      await requireConnection();
      return json({ ok: true, ...(await refreshStock(admin, businessId)) });
    }

    // --------------------------------------------------------- list-products
    if (action === 'list-products') {
      const connection = await requireConnection();
      const storeLocation = (connection as { default_location_gid?: string | null }).default_location_gid ?? null;
      const data = await run<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyProductNode }>;
        };
      }>(
        PRODUCTS_QUERY,
        {
          first: Math.min(Number(body.first ?? 10), 25),
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
          // Stock de la tienda (como en Pymova), no la suma de todas las ubicaciones.
          stockByVariant.set(v.id, availableAtLocation(rows, storeLocation));
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

      // El catálogo va por lotes: cada llamada procesa como mucho `max_pages` páginas de 10
      // productos y devuelve `next_cursor` para seguir en la siguiente (una edge function no
      // puede estar minutos seguidos). `run_id` continúa el mismo registro de sincronización.
      const batchCursor = typeof body.after === 'string' && body.after ? body.after : null;
      const maxPages = scopeOption === 'catalog' ? Math.min(Math.max(Number(body.max_pages ?? 3), 1), 10) : 50;
      const continueRunId = typeof body.run_id === 'string' && body.run_id ? body.run_id : null;

      type SyncRunRow = { id: string; created_count: number; updated_count: number; failed_count: number };
      let syncRun: SyncRunRow | null = null;
      if (continueRunId) {
        const { data } = await admin
          .from('integration_sync_runs')
          .select('id, created_count, updated_count, failed_count')
          .eq('id', continueRunId)
          .eq('business_id', businessId)
          .eq('status', 'running')
          .maybeSingle();
        syncRun = (data as SyncRunRow | null) ?? null;
        if (!syncRun) return json({ error: 'La sincronización que se quería continuar ya no está en marcha' }, 409);
      } else {
        // Una ejecución anterior que se quedó a medias (la función se cortó) no debe figurar como en marcha.
        await admin
          .from('integration_sync_runs')
          .update({ status: 'error', message: 'Interrumpida: no terminó', finished_at: new Date().toISOString() })
          .eq('business_id', businessId)
          .eq('integration_key', 'shopify')
          .eq('status', 'running')
          .lt('started_at', new Date(Date.now() - 10 * 60000).toISOString());
        const { data } = await admin
          .from('integration_sync_runs')
          .insert({
            business_id: businessId,
            integration_key: 'shopify',
            scope: scopeOption,
            status: 'running',
            created_by: userData.user.id,
          })
          .select('id, created_count, updated_count, failed_count')
          .single();
        syncRun = (data as SyncRunRow | null) ?? null;
      }

      let created = syncRun?.created_count ?? 0;
      let updated = syncRun?.updated_count ?? 0;
      let failed = syncRun?.failed_count ?? 0;
      let nextCursor: string | null = null;
      const messages: string[] = [];

      const firstErrors: string[] = [];
      const logIssue = async (
        entityType: string,
        entityName: string | null,
        externalId: string | null,
        message: string,
      ) => {
        failed += 1;
        if (firstErrors.length < 3) firstErrors.push(`${entityType}: ${message.slice(0, 160)}`);
        if (!syncRun) return;
        const { error: issueError } = await admin.from('integration_sync_issues').insert({
          business_id: businessId,
          run_id: syncRun.id,
          entity_type: entityType,
          entity_name: entityName || externalId || 'Sin nombre',
          external_id: externalId,
          attempts: 1,
          error_message: (message || 'Error desconocido').slice(0, 500),
        });
        // Si ni siquiera se puede registrar la incidencia, que quede en el resumen del run.
        if (issueError && firstErrors.length < 4) {
          firstErrors.push(`registro de incidencias: ${issueError.message.slice(0, 160)}`);
        }
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
          let cursor: string | null = batchCursor;
          for (let page = 0; page < maxPages; page++) {
            const data: {
              products: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{ node: ShopifyProductNode }>;
              };
            } = await run(PRODUCTS_QUERY, { first: 10, after: cursor, query: null }, [
              'read_products',
            ]);

            for (const { node } of data.products.edges) {
              try {
                const result = await upsertShopifyProduct(admin, businessId, node, {
                  createdBy: userData.user.id,
                  stock: 'all',
                  locations,
                });
                if (result.created) created += 1;
                else updated += 1;
                for (const issue of result.issues) {
                  await logIssue(issue.entity, node.title, node.id, issue.message);
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
            if (page === maxPages - 1) nextCursor = cursor;
          }
        }

        // Lote intermedio: se guarda el avance y el cliente sigue con `next_cursor`.
        if (nextCursor && syncRun) {
          await admin
            .from('integration_sync_runs')
            .update({ created_count: created, updated_count: updated, failed_count: failed, processed_count: created + updated + failed })
            .eq('id', syncRun.id);
          return json({ ok: true, partial: true, next_cursor: nextCursor, run_id: syncRun.id, created, updated, failed });
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
              { first: 50, after: cursor, query: `updated_at:>='${since}' AND -tag:pymova-tpv` },
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
                await logIssue('order', node.name, node.id, errorText(err));
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
                await logIssue('customer', name, node.id, errorText(err));
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
          ...firstErrors,
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
