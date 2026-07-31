// Procesamiento diferido de webhooks de Shopify.
// El endpoint HTTP sólo encola y responde 200; aquí se hace el trabajo real.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  isCatalogTopic,
  ORDER_TOPICS,
  orderGidFromPayload,
  retryDelaySeconds,
} from '../_shared/shopify-core.ts';
import { shopifyGraphql } from '../_shared/shopify-client.ts';
import {
  buildUpsertArgs,
  ORDER_BY_ID_QUERY,
  type ShopifyAdminOrder,
} from '../_shared/shopify-admin.ts';

const MAX_ATTEMPTS = 5;

export interface QueuedEvent {
  id: string;
  business_id: string | null;
  topic: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  shop_domain: string | null;
}

/** Ejecuta un evento encolado. Devuelve el estado final. */
export async function processEvent(
  admin: SupabaseClient,
  event: QueuedEvent,
): Promise<{ status: string; message: string }> {
  const topic = event.topic;
  const payload = event.payload ?? {};

  if (topic === 'app/uninstalled') {
    const shop = event.shop_domain;
    if (shop) {
      await admin
        .from('shopify_connections')
        .update({ uninstalled_at: new Date().toISOString(), last_sync_status: 'disconnected' })
        .eq('shop_domain', shop);
      await admin.from('shopify_app_tokens').delete().eq('shop_domain', shop);
    }
    return { status: 'processed', message: 'La aplicación se ha desinstalado de la tienda' };
  }

  if (!event.business_id) {
    return { status: 'ignored', message: 'Tienda no vinculada a ningún negocio' };
  }

  if (ORDER_TOPICS.includes(topic)) {
    const { data: connection } = await admin
      .from('shopify_connections')
      .select('orders_sync_enabled')
      .eq('business_id', event.business_id)
      .maybeSingle();
    if (!connection?.orders_sync_enabled) {
      return { status: 'ignored', message: 'La sincronización de pedidos está desactivada' };
    }

    const orderGid = orderGidFromPayload(payload);
    if (!orderGid) return { status: 'ignored', message: 'Sin identificador de pedido' };

    const data = await shopifyGraphql<{ order: ShopifyAdminOrder | null }>(
      ORDER_BY_ID_QUERY,
      { id: orderGid },
      { requiredScopes: ['read_orders'] },
    );
    if (!data.order) return { status: 'ignored', message: 'Pedido no encontrado en Shopify' };

    const { data: result, error } = await admin.rpc(
      'upsert_external_order',
      buildUpsertArgs(event.business_id, data.order) as never,
    );
    if (error) throw error;
    const row = Array.isArray(result) ? result[0] : result;
    if (row?.order_id) {
      await admin.from('online_orders').update({ stock_applied: true }).eq('id', row.order_id);
      await syncFulfillmentsForOrder(admin, event.business_id, row.order_id, data.order);
    }
    return { status: 'processed', message: `${topic} · ${data.order.name}` };
  }

  if (isCatalogTopic(topic)) {
    return {
      status: 'processed',
      message: `${topic} registrado para la próxima sincronización de catálogo`,
    };
  }

  return { status: 'ignored', message: `Evento ${topic} sin acción asociada` };
}

/** Guarda los envíos (fulfillments) de un pedido evitando duplicados. */
export async function syncFulfillmentsForOrder(
  admin: SupabaseClient,
  businessId: string,
  localOrderId: string,
  order: { id: string; fulfillments: Array<{ trackingInfo: Array<{ number: string | null }> }> },
) {
  const detail = await shopifyGraphql<{
    order: {
      id: string;
      fulfillments: Array<{
        id: string;
        status: string;
        createdAt: string;
        deliveredAt: string | null;
        trackingInfo: Array<{ number: string | null; company: string | null; url: string | null }>;
        fulfillmentLineItems: { edges: Array<{ node: { id: string; quantity: number } }> };
      }>;
    } | null;
  }>(
    `query OrderFulfillments($id: ID!) {
       order(id: $id) {
         id
         fulfillments(first: 50) {
           id
           status
           createdAt
           deliveredAt
           trackingInfo { number company url }
           fulfillmentLineItems(first: 100) { edges { node { id quantity } } }
         }
       }
     }`,
    { id: order.id },
    { requiredScopes: ['read_fulfillments'] },
  ).catch(() => null);

  const fulfillments = detail?.order?.fulfillments ?? [];
  if (fulfillments.length === 0) return;

  const rows = fulfillments.map((f) => ({
    business_id: businessId,
    order_id: localOrderId,
    order_external_id: order.id,
    external_id: f.id,
    status: (f.status ?? 'unknown').toLowerCase(),
    tracking_number: f.trackingInfo[0]?.number ?? null,
    tracking_company: f.trackingInfo[0]?.company ?? null,
    tracking_url: f.trackingInfo[0]?.url ?? null,
    shipped_at: f.createdAt ?? null,
    delivered_at: f.deliveredAt ?? null,
    line_item_count: f.fulfillmentLineItems.edges.reduce((s, e) => s + e.node.quantity, 0),
    updated_at: new Date().toISOString(),
  }));

  await admin
    .from('shopify_fulfillments')
    .upsert(rows, { onConflict: 'business_id,external_id' });
}

/** Toma eventos pendientes y los procesa con reintentos exponenciales. */
export async function drainWebhookQueue(admin: SupabaseClient, limit = 20): Promise<number> {
  const { data: events } = await admin
    .from('integration_webhook_events')
    .select('id, business_id, topic, payload, attempts, shop_domain')
    .eq('integration_key', 'shopify')
    .in('status', ['pending', 'retrying'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  let handled = 0;
  for (const event of (events ?? []) as QueuedEvent[]) {
    const attempts = (event.attempts ?? 0) + 1;
    try {
      const result = await processEvent(admin, event);
      await admin
        .from('integration_webhook_events')
        .update({
          status: result.status,
          message: result.message.slice(0, 500),
          attempts,
          processed_at: new Date().toISOString(),
        })
        .eq('id', event.id);
      handled += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      const exhausted = attempts >= MAX_ATTEMPTS;
      await admin
        .from('integration_webhook_events')
        .update({
          status: exhausted ? 'error' : 'retrying',
          message: message.slice(0, 500),
          attempts,
          next_attempt_at: new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString(),
          processed_at: exhausted ? new Date().toISOString() : null,
        })
        .eq('id', event.id);
    }
  }
  return handled;
}
