import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  adminGraphql,
  buildUpsertArgs,
  getShopDomain,
  localOrderStatuses,
  ORDERS_HISTORY_QUERY,
  ORDERS_QUERY,
  type ShopifyAdminOrder,
} from '../_shared/shopify-admin.ts';
import { shopifyGraphql } from '../_shared/shopify-client.ts';
import { fulfillmentOrdersToShip, isPymovaPosOrder, shipmentTracking } from '../_shared/shopify-core.ts';
import { upsertShopifyCustomers } from '../_shared/shopify-customers-db.ts';
import { historyBuyers } from '../_shared/shopify-history.ts';

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
  'CUSTOMERS_UPDATE',
  'CUSTOMERS_DELETE',
  'APP_UNINSTALLED',
];

/** Permisos de Shopify para leer y crear envíos en las ubicaciones de la tienda. */
const FULFILLMENT_SCOPES = ['read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders'];

const FULFILLMENT_ORDERS_QUERY = `
  query PedidoParaEnviar($id: ID!) {
    order(id: $id) {
      id
      tags
      fulfillmentOrders(first: 10) { nodes { id status } }
    }
  }
`;

const FULFILLMENT_CREATE = `
  mutation EnviarPedido($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

const PICKING_QUERY = `
  query ListaDePreparacion($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
        tags
        shippingAddress { name city }
        lineItems(first: 100) {
          nodes { title variantTitle sku currentQuantity variant { barcode } }
        }
      }
    }
  }
`;

type PickingNode = {
  id: string;
  name: string;
  tags: string[];
  shippingAddress: { name: string | null; city: string | null } | null;
  lineItems: {
    nodes: Array<{
      title: string;
      variantTitle: string | null;
      sku: string | null;
      currentQuantity: number;
      variant: { barcode: string | null } | null;
    }>;
  };
};

/** Acciones que puede hacer el personal (preparar y enviar); el resto, solo administradores. */
const STAFF_ACTIONS = ['push-status', 'picking-list'];

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

    const staffAction = STAFF_ACTIONS.includes(action);
    const { data: hasRole } = await userClient.rpc('has_min_role', {
      _business_id: businessId,
      _min_role: staffAction ? 'staff' : 'admin',
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!hasRole && !isSuper) {
      return json({ error: staffAction ? 'No tienes permisos en este negocio' : 'Necesitas permisos de administrador' }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const shop = getShopDomain();

    // Aislamiento estricto: la tienda pertenece a un único negocio.
    const { data: connection } = await admin
      .from('shopify_connections')
      .select('*')
      .eq('shop_domain', shop)
      .maybeSingle();

    if (action === 'status') {
      return json({
        shop_domain: shop,
        claimed: !!connection && connection.business_id === businessId,
        connection: connection?.business_id === businessId ? connection : null,
      });
    }

    // Las acciones de "empuje" no deben romper el flujo local si la tienda no está vinculada.
    const isPushAction = action === 'push-status' || action === 'push-refund';

    if (!connection) {
      if (isPushAction) {
        return json({ ok: true, skipped: 'La tienda de Shopify no está vinculada a este negocio.' });
      }
      return json(
        { error: 'Esta tienda de Shopify todavía no está vinculada a ningún negocio.' },
        409,
      );
    }
    if (connection.business_id !== businessId) {
      if (isPushAction) {
        return json({ ok: true, skipped: 'La tienda de Shopify pertenece a otro negocio.' });
      }
      return json({ error: 'Esta tienda de Shopify pertenece a otro negocio.' }, 403);
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
        .update({ webhooks_registered_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('shop_domain', shop);


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
            query: `updated_at:>='${since}' AND -tag:pymova-tpv`,
          });

          const localStatus = await localOrderStatuses(admin, businessId, data.orders.edges.map((e) => e.node.id));
          for (const { node } of data.orders.edges) {
            try {
              const { data: result, error } = await admin.rpc(
                'upsert_external_order',
                buildUpsertArgs(businessId, node, localStatus.get(node.id)) as never,
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
          .update({ last_orders_sync_at: new Date().toISOString() })
          .eq('business_id', businessId)
          .eq('shop_domain', shop);


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

    if (action === 'import-history') {
      // Historial completo de pedidos web, por tandas: cada llamada procesa unas páginas y
      // devuelve dónde seguir. Guardar pedidos no mueve stock. Repetirla actualiza sin duplicar.
      const HISTORY_FILTER = '-tag:pymova-tpv';
      let cursor: string | null = typeof body.cursor === 'string' && body.cursor ? body.cursor : null;
      const pages = Math.min(Math.max(Number(body.pages ?? 4) || 4, 1), 8);
      let total: number | null = null;
      if (!cursor) {
        const c = await adminGraphql<{ ordersCount: { count: number } }>(
          `query HistoryCount($q: String) { ordersCount(query: $q, limit: null) { count } }`,
          { q: HISTORY_FILTER },
        );
        total = c.ordersCount.count;
      }

      let created = 0;
      let updated = 0;
      let failed = 0;
      let customersCreated = 0;
      let done = false;
      for (let page = 0; page < pages; page++) {
        const data: {
          orders: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            edges: Array<{ node: ShopifyAdminOrder }>;
          };
        } = await adminGraphql(ORDERS_HISTORY_QUERY, { first: 50, after: cursor, query: HISTORY_FILTER });
        const nodes = data.orders.edges.map((e) => e.node);

        // Primero quien compró (como en los avisos de Shopify), para que el pedido se una a ella.
        const buyers = historyBuyers(nodes);
        if (buyers.length) {
          const res = await upsertShopifyCustomers(admin, businessId, buyers, {
            allowInsert: true,
            createdBy: userData.user.id,
          });
          customersCreated += res.created;
        }

        const saved: string[] = [];
        const localStatus = await localOrderStatuses(admin, businessId, nodes.map((n) => n.id));
        for (const node of nodes) {
          try {
            const { data: result, error } = await admin.rpc(
              'upsert_external_order',
              buildUpsertArgs(businessId, node, localStatus.get(node.id)) as never,
            );
            if (error) throw error;
            const row = Array.isArray(result) ? result[0] : result;
            if (row?.was_created) created += 1;
            else updated += 1;
            if (row?.order_id) saved.push(row.order_id);
          } catch (err) {
            console.error('Error al importar pedido', node.name, err);
            failed += 1;
          }
        }
        if (saved.length) {
          await admin.from('online_orders').update({ stock_applied: true }).in('id', saved);
        }

        if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) {
          done = true;
          cursor = null;
          break;
        }
        cursor = data.orders.pageInfo.endCursor;
      }

      if (done) {
        await admin
          .from('shopify_connections')
          .update({ orders_history_imported_at: new Date().toISOString() })
          .eq('business_id', businessId)
          .eq('shop_domain', shop);
      }
      return json({ ok: true, total, created, updated, failed, customers_created: customersCreated, cursor, done });
    }

    if (action === 'push-status') {
      const orderId = String(body.order_id ?? '');
      const status = String(body.status ?? '');
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

      // Las ventas de la caja de PYMOVA nunca se preparan ni se envían desde aquí.
      const { data: posSale } = await admin
        .from('sales')
        .select('id')
        .eq('business_id', businessId)
        .eq('shopify_order_gid', order.external_id)
        .limit(1)
        .maybeSingle();
      if (posSale) return json({ error: 'Es una venta de la caja de PYMOVA: no se envía desde Pedidos web' }, 409);

      if (status === 'shipped') {
        const data = await shopifyGraphql<{
          order: { id: string; tags: string[]; fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null;
        }>(FULFILLMENT_ORDERS_QUERY, { id: order.external_id }, { requiredScopes: FULFILLMENT_SCOPES });
        if (!data.order) return json({ error: 'El pedido ya no existe en Shopify' }, 404);
        if (isPymovaPosOrder(data.order)) {
          return json({ error: 'Es una venta de la caja de PYMOVA: no se envía desde Pedidos web' }, 409);
        }

        const toShip = fulfillmentOrdersToShip(data.order.fulfillmentOrders.nodes);
        if (toShip.length === 0) {
          return json({ ok: true, skipped: 'En Shopify no queda nada por enviar de este pedido' });
        }
        const trackingInfo = shipmentTracking(body.tracking_company, body.tracking_number);
        const notifyCustomer = body.notify_customer !== false;
        // Uno por bloque: fulfillmentCreate exige que los de una misma llamada sean de la misma ubicación.
        for (const fulfillmentOrderId of toShip) {
          const result = await shopifyGraphql<{
            fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
          }>(
            FULFILLMENT_CREATE,
            {
              fulfillment: {
                lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
                notifyCustomer,
                ...(trackingInfo ? { trackingInfo } : {}),
              },
            },
            { requiredScopes: FULFILLMENT_SCOPES },
          );
          const errors = result.fulfillmentCreate?.userErrors ?? [];
          if (errors.length) throw new Error(errors.map((e) => e.message).join(', '));
        }
        return json({ ok: true, shipped: toShip.length });
      }

      // Cancelar desde PYMOVA no toca Shopify: allí se repone el stock y, con Stockagile, podría
      // reponerse dos veces. Se cancela en Shopify a mano.
      if (status === 'cancelled') {
        return json({ ok: true, skipped: 'Cancelado en PYMOVA. Cancélalo también en Shopify.' });
      }

      return json({ ok: true });
    }

    if (action === 'picking-list') {
      const ids = (Array.isArray(body.order_ids) ? body.order_ids : []).map(String).slice(0, 100);
      if (ids.length === 0) return json({ error: 'Elige los pedidos' }, 400);

      const { data: rows, error: rowsError } = await admin
        .from('online_orders')
        .select('id, external_id')
        .eq('business_id', businessId)
        .eq('source', 'shopify')
        .in('id', ids);
      if (rowsError) throw rowsError;
      const gids = (rows ?? []).map((r) => r.external_id as string | null).filter((g): g is string => !!g);
      if (gids.length === 0) return json({ ok: true, orders: [] });

      const data = await shopifyGraphql<{ nodes: Array<PickingNode | null> }>(
        PICKING_QUERY,
        { ids: gids },
        { requiredScopes: ['read_orders'] },
      );
      const orders = (data.nodes ?? [])
        .filter((n): n is PickingNode => !!n?.id && !isPymovaPosOrder(n))
        .map((n) => ({
          name: n.name,
          customer: n.shippingAddress?.name ?? null,
          city: n.shippingAddress?.city ?? null,
          lines: n.lineItems.nodes.map((l) => ({
            title: l.title,
            size: l.variantTitle,
            sku: l.sku,
            barcode: l.variant?.barcode ?? null,
            quantity: l.currentQuantity,
          })),
        }));
      return json({ ok: true, orders });
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
