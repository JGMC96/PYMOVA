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
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'INVENTORY_LEVELS_UPDATE',
  'APP_UNINSTALLED',
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

    if (action === 'diagnose') {
      try {
        const data = await adminGraphql<{
          currentAppInstallation: { accessScopes: Array<{ handle: string }> };
        }>(`query { currentAppInstallation { accessScopes { handle } } }`);
        const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
        const required = ['read_orders', 'write_orders'];
        return json({
          ok: true,
          shop_domain: shop,
          scopes,
          missing: required.filter((r) => !scopes.includes(r)),
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500);
      }
    }


    if (action === 'register-webhooks') {
      // Sin token en la URL: la autenticidad se valida con la firma HMAC.
      const callbackUrl = `${SUPABASE_URL}/functions/v1/shopify-orders-webhook`;

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
        const withRefund = body.refund === true;
        const result = await adminGraphql<{
          orderCancel: { userErrors: Array<{ message: string }> };
        }>(
          `mutation Cancel($orderId: ID!, $refund: Boolean!) {
             orderCancel(orderId: $orderId, reason: OTHER, refund: $refund, restock: true, notifyCustomer: true) {
               userErrors { message }
             }
           }`,
          { orderId: order.external_id, refund: withRefund },
        );
        const errors = result.orderCancel?.userErrors ?? [];
        if (errors.length) throw new Error(errors.map((e) => e.message).join(', '));
      }

      return json({ ok: true });
    }

    if (action === 'push-refund') {
      const returnId = String(body.return_id ?? '');
      if (!returnId) return json({ error: 'Falta la devolución' }, 400);

      const { data: ret } = await admin
        .from('online_order_returns')
        .select('id, business_id, order_id, total, reason, return_number, kind')
        .eq('id', returnId)
        .eq('business_id', businessId)
        .maybeSingle();

      if (!ret) return json({ error: 'Devolución no encontrada' }, 404);

      const { data: order } = await admin
        .from('online_orders')
        .select('id, external_id, source, order_number')
        .eq('id', ret.order_id)
        .maybeSingle();

      if (!order || order.source !== 'shopify' || !order.external_id) {
        await admin
          .from('online_order_returns')
          .update({ external_sync_status: 'not_applicable' })
          .eq('id', returnId);
        return json({ ok: true, skipped: 'El pedido no proviene de Shopify' });
      }

      const markError = async (message: string) => {
        await admin
          .from('online_order_returns')
          .update({
            external_source: 'shopify',
            external_sync_status: 'error',
            external_sync_error: message,
          })
          .eq('id', returnId);
      };

      try {
        const data = await adminGraphql<{
          order: {
            currencyCode: string;
            transactions: Array<{ id: string; kind: string; status: string; gateway: string }>;
            lineItems: { edges: Array<{ node: { id: string; refundableQuantity: number } }> };
          } | null;
        }>(
          `query($id: ID!) {
             order(id: $id) {
               currencyCode
               transactions(first: 20) { id kind status gateway }
               lineItems(first: 100) { edges { node { id refundableQuantity } } }
             }
           }`,
          { id: order.external_id },
        );

        if (!data.order) throw new Error('El pedido ya no existe en Shopify');

        const parent = data.order.transactions.find(
          (t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS',
        );

        const amount = Number(ret.total ?? 0);
        const note = `${ret.kind === 'exchange' ? 'Cambio' : 'Devolución'} ${ret.return_number} · Pymova${
          ret.reason ? ` · ${ret.reason}` : ''
        }`;

        const input: Record<string, unknown> = {
          orderId: order.external_id,
          note,
          notifyCustomer: true,
        };

        if (parent && amount > 0) {
          input.transactions = [
            {
              orderId: order.external_id,
              gateway: parent.gateway,
              kind: 'REFUND',
              amount: amount.toFixed(2),
              parentId: parent.id,
            },
          ];
        } else {
          const refundLineItems = data.order.lineItems.edges
            .filter((e) => e.node.refundableQuantity > 0)
            .map((e) => ({
              lineItemId: e.node.id,
              quantity: e.node.refundableQuantity,
              restockType: 'NO_RESTOCK',
            }));
          if (refundLineItems.length === 0) {
            throw new Error('No hay importe ni líneas reembolsables en Shopify');
          }
          input.refundLineItems = refundLineItems;
        }

        const result = await adminGraphql<{
          refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> };
        }>(
          `mutation Refund($input: RefundInput!) {
             refundCreate(input: $input) {
               refund { id }
               userErrors { message }
             }
           }`,
          { input },
        );

        const errors = result.refundCreate?.userErrors ?? [];
        if (errors.length) throw new Error(errors.map((e) => e.message).join(', '));

        await admin
          .from('online_order_returns')
          .update({
            external_source: 'shopify',
            external_refund_id: result.refundCreate.refund?.id ?? null,
            external_sync_status: 'synced',
            external_sync_error: null,
            external_synced_at: new Date().toISOString(),
          })
          .eq('id', returnId);

        return json({ ok: true, refund_id: result.refundCreate.refund?.id ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        await markError(message);
        return json({ error: message }, 500);
      }
    }



    return json({ error: 'Acción no soportada' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('shopify-orders error:', message);
    return json({ error: message }, 500);
  }
});
