import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  adminGraphql,
  buildUpsertArgs,
  ORDER_BY_ID_QUERY,
  type ShopifyAdminOrder,
} from '../_shared/shopify-admin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const expected = Deno.env.get('SHOPIFY_WEBHOOK_TOKEN') ?? '';
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!expected || !timingSafeEqual(token, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const topic = req.headers.get('x-shopify-topic') ?? 'unknown';
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? '';
  const eventId = req.headers.get('x-shopify-webhook-id');

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
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

    if (!connection || !connection.orders_sync_enabled) {
      // Acknowledge so Shopify does not retry forever.
      return new Response('ok', { status: 200 });
    }

    if (eventId) {
      const { data: seen } = await admin
        .from('integration_webhook_events')
        .select('id')
        .eq('integration_key', 'shopify')
        .eq('event_id', eventId)
        .maybeSingle();
      if (seen) return new Response('ok', { status: 200 });
    }

    // Never trust the payload: re-fetch the authoritative order from Shopify.
    const orderGid =
      typeof payload.admin_graphql_api_id === 'string'
        ? payload.admin_graphql_api_id
        : typeof payload.order_id === 'number' || typeof payload.order_id === 'string'
          ? `gid://shopify/Order/${payload.order_id}`
          : typeof payload.id === 'number' || typeof payload.id === 'string'
            ? `gid://shopify/Order/${payload.id}`
            : null;

    let status = 'ignored';
    let message: string | null = 'Sin identificador de pedido';

    if (orderGid && orderGid.includes('/Order/')) {
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
    }

    await admin.from('integration_webhook_events').insert({
      business_id: connection.business_id,
      integration_key: 'shopify',
      topic,
      external_id: orderGid,
      event_id: eventId,
      status,
      message,
      payload,
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
      message: errorMessage,
      payload,
    });
    return new Response('error', { status: 500 });
  }
});
