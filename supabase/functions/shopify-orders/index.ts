import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  adminGraphql,
  buildUpsertArgs,
  getShopDomain,
  ORDERS_QUERY,
  type ShopifyAdminOrder,
} from '../_shared/shopify-admin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'ORDERS_FULFILLED',
  'REFUNDS_CREATE',
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
    const action = String(body.action ?? 'sync');
    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isAdmin } = await userClient.rpc('has_min_role', {
      _business_id: businessId,
      _min_role: 'admin',
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isAdmin && !isSuper) return json({ error: 'Necesitas permisos de administrador' }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const shop = getShopDomain();

    if (action === 'status') {
      const { data: connection } = await admin
        .from('shopify_connections')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle();
      return json({ shop_domain: shop, connection });
    }

    if (action === 'register-webhooks') {
      const callbackUrl = `${SUPABASE_URL}/functions/v1/shopify-orders-webhook?token=${
        Deno.env.get('SHOPIFY_WEBHOOK_TOKEN') ?? ''
      }`;

      const existing = await adminGraphql<{
        webhookSubscriptions: { edges: Array<{ node: { id: string; topic: string; endpoint: { callbackUrl?: string } } }> };
      }>(
        `query { webhookSubscriptions(first: 100) { edges { node { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } } }`,
      );

      const created: string[] = [];
      for (const topic of WEBHOOK_TOPICS) {
        const match = existing.webhookSubscriptions.edges.find((e) => e.node.topic === topic);
        if (match) {
          if (match.node.endpoint?.callbackUrl === callbackUrl) continue;
          await adminGraphql(
            `mutation Del($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`,
            { id: match.node.id },
          );
        }
        const result = await adminGraphql<{
          webhookSubscriptionCreate: { userErrors: Array<{ message: string }> };
        }>(
          `mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
             webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
               userErrors { message }
             }
           }`,
          { topic, sub: { callbackUrl, format: 'JSON' } },
        );
        const errors = result.webhookSubscriptionCreate.userErrors;
        if (errors?.length) throw new Error(`${topic}: ${errors.map((e) => e.message).join(', ')}`);
        created.push(topic);
      }

      await admin
        .from('shopify_connections')
        .upsert(
          {
            business_id: businessId,
            shop_domain: shop,
            webhooks_registered_at: new Date().toISOString(),
            created_by: userData.user.id,
          },
          { onConflict: 'shop_domain' },
        );

      return json({ ok: true, topics: created, callback_url: callbackUrl.split('?')[0] });
    }

    if (action === 'sync') {
      const days = Number(body.days ?? 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: run } = await admin
        .from('integration_sync_runs')
        .insert({
          business_id: businessId,
          integration_key: 'shopify',
          scope: 'orders',
          status: 'running',
          created_by: userData.user.id,
        })
        .select('id')
        .single();

      let created = 0;
      let updated = 0;
      let failed = 0;
      let cursor: string | null = null;

      try {
        for (let page = 0; page < 10; page++) {
          const data: {
            orders: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              edges: Array<{ node: ShopifyAdminOrder }>;
            };
          } = await adminGraphql(ORDERS_QUERY, {
            first: 50,
            after: cursor,
            query: `updated_at:>='${since}'`,
          });

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
              }
            } catch (err) {
              console.error('Error al sincronizar pedido', node.name, err);
              failed += 1;
            }
          }

          if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) break;
          cursor = data.orders.pageInfo.endCursor;
        }

        await admin
          .from('shopify_connections')
          .upsert(
            {
              business_id: businessId,
              shop_domain: shop,
              last_orders_sync_at: new Date().toISOString(),
              created_by: userData.user.id,
            },
            { onConflict: 'shop_domain' },
          );

        if (run) {
          await admin
            .from('integration_sync_runs')
            .update({
              status: failed > 0 ? 'partial' : 'success',
              created_count: created,
              updated_count: updated,
              failed_count: failed,
              finished_at: new Date().toISOString(),
              message: `Pedidos actualizados desde ${since.slice(0, 10)}`,
            })
            .eq('id', run.id);
        }

        return json({ ok: true, created, updated, failed });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
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
        return json({ error: message }, 500);
      }
    }

    if (action === 'push-status') {
      const orderId = String(body.order_id ?? '');
      const status = String(body.status ?? '');
      const tracking = body.tracking_number ? String(body.tracking_number) : null;
      if (!orderId || !status) return json({ error: 'Faltan datos del pedido' }, 400);

      const { data: order } = await admin
        .from('online_orders')
        .select('id, business_id, external_id, source')
        .eq('id', orderId)
        .eq('business_id', businessId)
        .maybeSingle();

      if (!order) return json({ error: 'Pedido no encontrado' }, 404);
      if (order.source !== 'shopify' || !order.external_id) {
        return json({ ok: true, skipped: 'El pedido no proviene de Shopify' });
      }

      if (status === 'shipped') {
        const data = await adminGraphql<{
          order: { fulfillmentOrders: { edges: Array<{ node: { id: string; status: string } }> } } | null;
        }>(
          `query($id: ID!) {
             order(id: $id) {
               fulfillmentOrders(first: 10) { edges { node { id status } } }
             }
           }`,
          { id: order.external_id },
        );

        const openOrders = (data.order?.fulfillmentOrders.edges ?? [])
          .filter((e) => ['OPEN', 'IN_PROGRESS', 'SCHEDULED'].includes(e.node.status))
          .map((e) => ({ fulfillmentOrderId: e.node.id }));

        if (openOrders.length > 0) {
          const result = await adminGraphql<{
            fulfillmentCreateV2: { userErrors: Array<{ message: string }> };
          }>(
            `mutation Fulfill($fulfillment: FulfillmentV2Input!) {
               fulfillmentCreateV2(fulfillment: $fulfillment) {
                 userErrors { message }
               }
             }`,
            {
              fulfillment: {
                lineItemsByFulfillmentOrder: openOrders,
                notifyCustomer: true,
                trackingInfo: tracking ? { number: tracking } : undefined,
              },
            },
          );
          const errors = result.fulfillmentCreateV2?.userErrors ?? [];
          if (errors.length) throw new Error(errors.map((e) => e.message).join(', '));
        }
      }

      if (status === 'cancelled') {
        const result = await adminGraphql<{
          orderCancel: { userErrors: Array<{ message: string }> };
        }>(
          `mutation Cancel($orderId: ID!) {
             orderCancel(orderId: $orderId, reason: OTHER, refund: false, restock: true, notifyCustomer: true) {
               userErrors { message }
             }
           }`,
          { orderId: order.external_id },
        );
        const errors = result.orderCancel?.userErrors ?? [];
        if (errors.length) throw new Error(errors.map((e) => e.message).join(', '));
      }

      return json({ ok: true });
    }

    return json({ error: 'Acción no soportada' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('shopify-orders error:', message);
    return json({ error: message }, 500);
  }
});
