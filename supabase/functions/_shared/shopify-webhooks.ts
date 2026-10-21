// Procesamiento diferido de webhooks de Shopify.
// El endpoint HTTP sólo encola y responde 200; aquí se hace el trabajo real.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  catalogAction,
  isCatalogTopic,
  levelFromInventoryWebhook,
  ORDER_TOPICS,
  orderGidFromPayload,
  PRODUCT_BY_ID_QUERY,
  productGidFromPayload,
  retryDelaySeconds,
  type ShopifyProductNode,
} from '../_shared/shopify-core.ts';
import { upsertShopifyProduct } from '../_shared/shopify-catalog.ts';
import { customerFromWebhook } from '../_shared/shopify-customers.ts';
import { retireShopifyCustomer, upsertShopifyCustomers } from '../_shared/shopify-customers-db.ts';
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

/** Estado compartido por los eventos de un mismo lote de la cola. */
export interface DrainContext {
  /** Productos ya leídos de Shopify en este lote: los avisos repetidos no vuelven a leerlo. */
  seenProducts: Set<string>;
}

/** Ejecuta un evento encolado. Devuelve el estado final. */
export async function processEvent(
  admin: SupabaseClient,
  event: QueuedEvent,
  ctx: DrainContext = { seenProducts: new Set() },
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

    if (String((payload as { tags?: unknown })?.tags ?? '').split(',').map((t) => t.trim()).includes('pymova-tpv')) {
      return { status: 'ignored', message: 'Venta de tienda creada por Pymova' };
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
    // Quien compra en la web entra (o se pone al día) en los clientes de PYMOVA.
    // Un fallo aquí no debe repetir el pedido: se anota en el mensaje.
    let customerNote = '';
    const c = data.order.customer;
    if (c?.id && (topic === 'orders/create' || topic === 'orders/updated' || topic === 'orders/paid')) {
      try {
        const res = await upsertShopifyCustomers(
          admin,
          event.business_id,
          [{ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone }],
          { allowInsert: true },
        );
        if (res.errors.length) customerNote = ` · cliente no guardado: ${res.errors[0].message}`;
        else if (res.created) customerNote = ' · cliente nuevo';
      } catch (err) {
        customerNote = ` · cliente no guardado: ${err instanceof Error ? err.message : 'error'}`;
      }
    }
    return { status: 'processed', message: `${topic} · ${data.order.name}${customerNote}` };
  }

  // Clientes: los cambios en Shopify se aplican a los que ya están en PYMOVA (los que han
  // comprado); un cliente borrado se desactiva y se le quitan el correo y el teléfono.
  if (topic === 'customers/update') {
    const customer = customerFromWebhook(payload);
    if (!customer) return { status: 'ignored', message: 'Aviso de cliente sin identificador' };
    const res = await upsertShopifyCustomers(admin, event.business_id, [customer], { allowInsert: false });
    if (res.errors.length) throw new Error(res.errors[0].message);
    return {
      status: res.updated ? 'processed' : 'ignored',
      message: res.updated ? 'Cliente actualizado' : 'Cliente sin cambios o que aún no ha comprado',
    };
  }
  if (topic === 'customers/delete') {
    const customer = customerFromWebhook(payload);
    if (!customer) return { status: 'ignored', message: 'Aviso de cliente sin identificador' };
    const n = await retireShopifyCustomer(admin, event.business_id, customer.id);
    return { status: n ? 'processed' : 'ignored', message: n ? 'Cliente borrado en Shopify: desactivado' : 'Cliente que no estaba en PYMOVA' };
  }

  // Stock: Shopify manda en la ubicación de la tienda; se aplica al momento.
  if (topic === 'inventory_levels/update') {
    const level = levelFromInventoryWebhook(payload);
    if (!level) {
      return { status: 'ignored', message: 'Webhook de inventario sin artículo, ubicación o cantidad' };
    }
    const { data, error } = await admin.rpc('apply_shopify_inventory_levels', {
      _business_id: event.business_id,
      _levels: [level],
      _source: 'shopify',
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { applied: number; stale: number; unknown: number }
      | null;
    if (row?.applied) {
      return { status: 'processed', message: `Stock actualizado: ${level.available} uds. en ${level.location_gid}` };
    }
    if (row?.stale) {
      return { status: 'ignored', message: 'Cambio de inventario más antiguo que el último aplicado' };
    }
    return { status: 'ignored', message: 'Artículo de Shopify no emparejado con Pymova' };
  }

  // Catálogo: los productos activos de Shopify entran solos; Shopify manda en los que
  // ya están (nombre, precio, tallas). Borradores y archivados no entran, y si ya
  // estaban se desactivan. Nunca se borra nada: tienen ventas e historial.
  if (topic === 'products/create' || topic === 'products/update' || topic === 'products/delete') {
    return await processProductEvent(admin, event.business_id, topic, payload, ctx);
  }

  if (isCatalogTopic(topic)) {
    return {
      status: 'processed',
      message: `${topic} registrado para la próxima sincronización de catálogo`,
    };
  }

  return { status: 'ignored', message: `Evento ${topic} sin acción asociada` };
}

/** Aviso de producto: lo lee en vivo de Shopify y lo crea, actualiza o desactiva. */
async function processProductEvent(
  admin: SupabaseClient,
  businessId: string,
  topic: string,
  payload: Record<string, unknown>,
  ctx: DrainContext,
): Promise<{ status: string; message: string }> {
  const gid = productGidFromPayload(payload);
  if (!gid) return { status: 'ignored', message: 'Aviso de producto sin identificador' };

  const { data: connection } = await admin
    .from('shopify_connections')
    .select('business_id, uninstalled_at')
    .eq('business_id', businessId)
    .maybeSingle();
  if (!connection || connection.uninstalled_at) {
    return { status: 'ignored', message: 'Sin tienda de Shopify vinculada' };
  }

  if (topic !== 'products/delete' && ctx.seenProducts.has(gid)) {
    return { status: 'processed', message: 'Producto ya leído de Shopify en este lote' };
  }

  const { data: local } = await admin
    .from('products')
    .select('id, name, is_active')
    .eq('business_id', businessId)
    .eq('external_source', 'shopify')
    .eq('external_id', gid)
    .maybeSingle();

  // Un borrado no se consulta: el producto ya no existe en Shopify.
  let node: ShopifyProductNode | null = null;
  if (topic !== 'products/delete') {
    const data = await shopifyGraphql<{ product: ShopifyProductNode | null }>(
      PRODUCT_BY_ID_QUERY,
      { id: gid },
      { requiredScopes: ['read_products', 'read_inventory'] },
    );
    node = data.product;
    ctx.seenProducts.add(gid);
  }

  const action = catalogAction(node?.status ?? null, !!local);

  if (action === 'skip') {
    return {
      status: 'ignored',
      message: node
        ? `Borrador o archivado en Shopify: «${node.title}» entrará cuando se active`
        : 'Producto borrado en Shopify que no estaba en Pymova',
    };
  }

  if (action === 'deactivate') {
    if (local!.is_active) {
      const { error } = await admin
        .from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', local!.id);
      if (error) throw error;
    }
    return {
      status: 'processed',
      message: node
        ? `Producto desactivado (no está activo en Shopify): ${local!.name}`
        : `Producto desactivado (borrado en Shopify): ${local!.name}`,
    };
  }

  const result = await upsertShopifyProduct(admin, businessId, node!, {
    createdBy: null,
    stock: 'new-items',
    deactivateMissingVariants: true,
  });
  const issues = result.issues.map((i) => i.message).join('; ');
  return {
    status: 'processed',
    message: `${result.created ? 'Producto importado' : 'Producto actualizado'}: ${node!.title}${issues ? ` (${issues})` : ''}`,
  };
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
  const ctx: DrainContext = { seenProducts: new Set() };
  for (const event of (events ?? []) as QueuedEvent[]) {
    const attempts = (event.attempts ?? 0) + 1;
    try {
      const result = await processEvent(admin, event, ctx);
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
