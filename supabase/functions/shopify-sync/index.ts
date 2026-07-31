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
import { ORDERS_QUERY, buildUpsertArgs, type ShopifyAdminOrder } from '../_shared/shopify-admin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          description
          productType
          vendor
          status
          updatedAt
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                inventoryQuantity
                availableForSale
                selectedOptions { name value }
              }
            }
          }
        }
      }
    }
  }
`;

const LOCATIONS_QUERY = `
  query { locations(first: 50) { edges { node { id name isActive } } } }
`;

const CUSTOMERS_QUERY = `
  query Customers($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node { id firstName lastName email phone note } }
    }
  }
`;

interface ShopifyGqlProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        price: string;
        inventoryQuantity: number | null;
        availableForSale: boolean;
        selectedOptions: Array<{ name: string; value: string }>;
      };
    }>;
  };
}

/** Forma que consume el frontend (catálogo navegable). */
function toClientProduct(node: ShopifyGqlProduct) {
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
          quantityAvailable: v.inventoryQuantity,
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

    // Aislamiento entre organizaciones: el usuario debe pertenecer al negocio.
    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'No tienes acceso a este negocio' }, 403);

    const requiresAdmin = ['verify', 'sync'].includes(action);
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

    const upsertConnection = async (patch: Record<string, unknown>) => {
      await admin.from('shopify_connections').upsert(
        {
          business_id: businessId,
          shop_domain: shop,
          api_version: SHOPIFY_API_VERSION,
          created_by: userData.user.id,
          ...patch,
        },
        { onConflict: 'shop_domain' },
      );
    };

    const loadStats = async () => {
      const [products, variants, orders, clients, issues] = await Promise.all([
        admin.from('products').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('external_source', 'shopify'),
        admin.from('product_variants').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('external_source', 'shopify'),
        admin.from('online_orders').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('source', 'shopify'),
        admin.from('clients').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('is_active', true),
        admin.from('integration_sync_issues').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('resolved', false),
      ]);
      return {
        products: products.count ?? 0,
        variants: variants.count ?? 0,
        orders: orders.count ?? 0,
        clients: clients.count ?? 0,
        open_issues: issues.count ?? 0,
      };
    };

    if (action === 'status') {
      const { data: connection } = await admin
        .from('shopify_connections')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle();

      return json({
        shop_domain: shop,
        api_version: SHOPIFY_API_VERSION,
        required_scopes: READ_SCOPES,
        connection,
        stats: await loadStats(),
      });
    }

    if (action === 'verify') {
      const result = await verifyConnection();
      await upsertConnection({
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

    if (action === 'list-products') {
      const data = await shopifyGraphql<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyGqlProduct }>;
        };
      }>(
        PRODUCTS_QUERY,
        {
          first: Math.min(Number(body.first ?? 50), 100),
          after: body.after ?? null,
          query: body.query ? String(body.query) : null,
        },
        { requiredScopes: ['read_products'] },
      );

      return json({
        products: data.products.edges.map((e) => toClientProduct(e.node)),
        hasNextPage: data.products.pageInfo.hasNextPage,
        endCursor: data.products.pageInfo.endCursor,
      });
    }

    if (action === 'sync') {
      const scopeOption = String(body.scope ?? 'all');
      const days = Number(body.days ?? 60);

      const { data: run } = await admin
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

      const logIssue = async (entityType: string, entityName: string, externalId: string | null, message: string) => {
        failed += 1;
        if (!run) return;
        await admin.from('integration_sync_issues').insert({
          business_id: businessId,
          run_id: run.id,
          entity_type: entityType,
          entity_name: entityName,
          external_id: externalId,
          attempts: 1,
          error_message: message.slice(0, 500),
        });
      };

      try {
        // --- Ubicaciones (informativo, no destructivo) ---
        let locationCount = 0;
        try {
          const locations = await shopifyGraphql<{
            locations: { edges: Array<{ node: { id: string; name: string; isActive: boolean } }> };
          }>(LOCATIONS_QUERY, {}, { requiredScopes: ['read_locations'] });
          locationCount = locations.locations.edges.length;
        } catch (err) {
          messages.push(err instanceof Error ? err.message : 'Error al leer ubicaciones');
        }

        // --- Productos, variantes, SKU, precios, inventario ---
        if (scopeOption === 'all' || scopeOption === 'catalog') {
          let cursor: string | null = null;
          for (let page = 0; page < 50; page++) {
            const data: {
              products: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{ node: ShopifyGqlProduct }>;
              };
            } = await shopifyGraphql(
              PRODUCTS_QUERY,
              { first: 50, after: cursor, query: null },
              { requiredScopes: ['read_products'] },
            );

            for (const { node } of data.products.edges) {
              try {
                const variants = node.variants.edges.map((e) => e.node);
                const first = variants[0];
                const totalStock = variants.reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0);

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
                  stock_quantity: totalStock,
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
                      stock_quantity: v.inventoryQuantity ?? 0,
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
                    } else {
                      await admin
                        .from('product_variants')
                        .insert({ ...variantPayload, created_by: userData.user.id });
                    }
                  }
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

        // --- Pedidos y líneas de pedido ---
        if (scopeOption === 'all' || scopeOption === 'orders') {
          const since = new Date(Date.now() - days * 86400000).toISOString();
          let cursor: string | null = null;
          for (let page = 0; page < 20; page++) {
            const data: {
              orders: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                edges: Array<{ node: ShopifyAdminOrder }>;
              };
            } = await shopifyGraphql(
              ORDERS_QUERY,
              { first: 50, after: cursor, query: `updated_at:>='${since}'` },
              { requiredScopes: ['read_orders'] },
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
                  await admin.from('online_orders').update({ stock_applied: true }).eq('id', row.order_id);
                }
              } catch (err) {
                await logIssue('order', node.name, node.id, err instanceof Error ? err.message : 'Error');
              }
            }

            if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
            cursor = data.orders.pageInfo.endCursor;
          }
        }

        // --- Clientes ---
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
            } = await shopifyGraphql(
              CUSTOMERS_QUERY,
              { first: 50, after: cursor },
              { requiredScopes: ['read_customers'] },
            );

            for (const { node } of data.customers.edges) {
              const name =
                [node.firstName, node.lastName].filter(Boolean).join(' ').trim() ||
                node.email ||
                'Cliente Shopify';
              try {
                if (!node.email) continue;
                const { data: existing } = await admin
                  .from('clients')
                  .select('id')
                  .eq('business_id', businessId)
                  .ilike('email', node.email)
                  .maybeSingle();

                if (existing) {
                  await admin
                    .from('clients')
                    .update({ name, phone: node.phone, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
                  updated += 1;
                } else {
                  await admin.from('clients').insert({
                    business_id: businessId,
                    name,
                    email: node.email,
                    phone: node.phone,
                    notes: node.note,
                    created_by: userData.user.id,
                  });
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
          locationCount ? `${locationCount} ubicaciones` : null,
          ...messages,
        ]
          .filter(Boolean)
          .join(' · ');

        if (run) {
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
            .eq('id', run.id);
        }

        const now = new Date().toISOString();
        await upsertConnection({
          last_sync_status: status,
          last_sync_error: null,
          last_catalog_sync_at:
            scopeOption === 'all' || scopeOption === 'catalog' ? now : undefined,
          last_orders_sync_at: scopeOption === 'all' || scopeOption === 'orders' ? now : undefined,
          last_verified_at: now,
        });

        return json({ ok: true, created, updated, failed, message: summaryMessage, stats: await loadStats() });
      } catch (err) {
        const message = err instanceof ShopifyError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Error desconocido';
        if (run) {
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
            .eq('id', run.id);
        }
        await upsertConnection({ last_sync_status: 'error', last_sync_error: message });
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
