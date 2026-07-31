// Webhooks de Shopify: verificación HMAC con el client secret de la app.
// No se aceptan tokens en la URL ni se registran datos sensibles.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  adminGraphql,
  buildUpsertArgs,
  ORDER_BY_ID_QUERY,
  type ShopifyAdminOrder,
} from '../_shared/shopify-admin.ts';
import { verifyWebhookHmac } from '../_shared/shopify-client.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ORDER_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'fulfillments/create',
  'fulfillments/update',
  'refunds/create',
];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const valid = await verifyWebhookHmac(rawBody, req.headers.get('x-shopify-hmac-sha256'));
  if (!valid) {
    console.warn('Webhook rechazado: firma HMAC inválida');
    return new Response('Unauthorized', { status: 401 });
  }

  const topic = (req.headers.get('x-shopify-topic') ?? 'unknown').toLowerCase();
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? '';
  const eventId = req.headers.get('x-shopify-webhook-id');

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: connection } = await admin
      .from('shopify_connections')
      .select('business_id, orders_sync_enabled')
      .eq('shop_domain', shopDomain)
      .maybeSingle();

    if (!connection) return new Response('ok', { status: 200 });

    // Idempotencia: un mismo webhook nunca se procesa dos veces.
    if (eventId) {
      const { data: seen } = await admin
        .from('integration_webhook_events')
        .select('id')
        .eq('integration_key', 'shopify')
        .eq('event_id', eventId)
        .maybeSingle();
      if (seen) return new Response('ok', { status: 200 });
    }

    let status = 'ignored';
    let message: string | null = `Evento ${topic} sin acción asociada`;

    if (topic === 'app/uninstalled') {
      await admin
        .from('shopify_connections')
        .update({ uninstalled_at: new Date().toISOString(), last_sync_status: 'disconnected' })
        .eq('shop_domain', shopDomain);
      await admin.from('shopify_app_tokens').delete().eq('shop_domain', shopDomain);
      status = 'processed';
      message = 'La aplicación se ha desinstalado de la tienda';
    } else if (ORDER_TOPICS.includes(topic) && connection.orders_sync_enabled) {
      const orderGid =
        typeof payload.admin_graphql_api_id === 'string' && payload.admin_graphql_api_id.includes('/Order/')
          ? payload.admin_graphql_api_id
          : payload.order_id !== undefined && payload.order_id !== null
            ? `gid://shopify/Order/${payload.order_id}`
            : payload.id !== undefined && payload.id !== null
              ? `gid://shopify/Order/${payload.id}`
              : null;

      if (orderGid) {
        const data = await adminGraphql<{ order: ShopifyAdminOrder | null }>(ORDER_BY_ID_QUERY, {
          id: orderGid,
        });
        if (data.order) {
          const { data: result, error } = await admin.rpc(
            'upsert_external_order',
            buildUpsertArgs(connection.business_id, data.order) as never,
          );
          if (error) throw error;
          const row = Array.isArray(result) ? result[0] : result;
          if (row?.order_id) {
            await admin.from('online_orders').update({ stock_applied: true }).eq('id', row.order_id);
          }
          status = 'processed';
          message = `${topic} · ${data.order.name}`;
        } else {
          message = 'Pedido no encontrado en Shopify';
        }
      } else {
        message = 'Sin identificador de pedido';
      }
    } else if (topic.startsWith('products/') || topic.startsWith('inventory_levels/')) {
      // Los cambios de catálogo se consolidan en la próxima sincronización.
      status = 'queued';
      message = `${topic} registrado para la próxima sincronización de catálogo`;
    }

    await admin.from('integration_webhook_events').insert({
      business_id: connection.business_id,
      integration_key: 'shopify',
      topic,
      external_id: typeof payload.admin_graphql_api_id === 'string' ? payload.admin_graphql_api_id : null,
      event_id: eventId,
      status,
      message,
      payload: { id: payload.id ?? null, topic },
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    console.error('shopify-orders-webhook error:', errorMessage);
    await admin.from('integration_webhook_events').insert({
      integration_key: 'shopify',
      topic,
      event_id: eventId,
      status: 'error',
      message: errorMessage.slice(0, 500),
      payload: { topic },
    });
    return new Response('error', { status: 500 });
  }
});
