// Crea en Shopify un pedido por cada venta de tienda (TPV) de Pymova.
// El stock ya lo ajusta shopify-inventory-push, por eso el pedido se crea con inventoryBehaviour BYPASS.
// Los pedidos llevan la etiqueta POS_TAG para que la traída de pedidos online los ignore.
// Sin duplicados: orderCreate no admite clave de idempotencia, así que cada venta se reclama
// antes (claim_pos_sales_for_shopify) y, antes de crear, se busca en Shopify si ya existe un
// pedido con su sourceIdentifier (una ejecución anterior pudo crearlo y cortarse).
// La llaman el TPV (usuario) y la tarea programada «shopify-tpv» (ticket de un solo uso).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';
import { posOrderAttributes, posTicketTags, posOrderSearchQuery } from '../_shared/shopify-core.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const POS_TAG = 'pymova-tpv';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ORDER_CREATE = `
  mutation PosOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

const ORDER_BY_SOURCE = `
  query PosOrderBySource($query: String!) {
    orders(first: 1, query: $query) { nodes { id name } }
  }
`;

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bizum: 'Bizum',
  transfer: 'Transferencia',
};

interface SaleRow {
  id: string;
  sale_number: string;
  total: number;
  tip: number | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  seller_employee_id: string | null;
  shopify_order_attempts: number;
  sale_items: Array<{
    product_id: string | null;
    variant_id: string | null;
    product_name: string;
    quantity: number;
    total: number;
  }>;
}

/** Guarda en la venta el pedido de Shopify. Si falla, lanza: la venta no queda a medias. */
async function markDone(admin: SupabaseClient, sale: SaleRow, order: { id: string; name: string }) {
  const { error } = await admin.from('sales').update({
    shopify_order_gid: order.id,
    shopify_order_name: order.name,
    shopify_order_status: 'done',
    shopify_order_error: null,
    shopify_order_attempts: sale.shopify_order_attempts + 1,
    shopify_order_claimed_at: null,
  }).eq('id', sale.id);
  if (error) throw new Error(`Pedido ${order.name} creado en Shopify, pero no se pudo guardar: ${error.message}`);
}

/** Envía a Shopify las ventas pendientes de un negocio. */
async function processBusiness(admin: SupabaseClient, businessId: string): Promise<Record<string, unknown>> {
  const { data: connection } = await admin
    .from('shopify_connections')
    .select('pos_orders_enabled, pos_orders_since, default_location_gid')
    .eq('business_id', businessId)
    .maybeSingle();
  if (!connection) return { status: 'skipped', reason: 'Sin tienda de Shopify vinculada' };
  if (!connection.pos_orders_enabled) return { status: 'skipped', reason: 'Pedidos de tienda desactivados' };

  // Reclama las ventas pendientes: dos ejecuciones a la vez nunca cogen la misma.
  const { data: claimed, error: claimError } = await admin.rpc('claim_pos_sales_for_shopify', {
    _business_id: businessId,
    _limit: BATCH_SIZE,
  });
  if (claimError) throw claimError;
  const ids = ((claimed ?? []) as string[]).filter(Boolean);
  if (ids.length === 0) return { status: 'ok', created: 0, linked: 0, failed: 0 };

  const { data: salesData, error: salesError } = await admin
    .from('sales')
    .select('id, sale_number, total, tip, payment_method, notes, created_at, seller_employee_id, shopify_order_attempts, sale_items(product_id, variant_id, product_name, quantity, total)')
    .in('id', ids)
    .order('created_at', { ascending: true });
  if (salesError) throw salesError;
  const sales = (salesData ?? []) as unknown as SaleRow[];

  const { data: levels } = await admin
    .from('shopify_inventory_levels')
    .select('variant_external_id, local_variant_id, local_product_id')
    .eq('business_id', businessId);
  const byVariant = new Map<string, string>();
  const byProduct = new Map<string, string>();
  for (const l of levels ?? []) {
    if (!l.variant_external_id) continue;
    if (l.local_variant_id) byVariant.set(l.local_variant_id, l.variant_external_id);
    else if (l.local_product_id) byProduct.set(l.local_product_id, l.variant_external_id);
  }
  const toGid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`);

  const shop = await shopifyGraphql<{ shop: { currencyCode: string } }>(`{ shop { currencyCode } }`);
  const currency = shop.shop.currencyCode;
  const money = (n: number) => ({ shopMoney: { amount: Number(n).toFixed(2), currencyCode: currency } });

  // Nombre de quien atendió cada venta (dependiente con o sin cuenta).
  const sellerNames = new Map<string, string>();
  for (const id of new Set(sales.map((s) => s.seller_employee_id).filter((v): v is string => !!v))) {
    const { data: name } = await admin.rpc('employee_display_name', { _employee_id: id });
    if (typeof name === 'string' && name) sellerNames.set(id, name);
  }

  let created = 0;
  let linked = 0;
  let failed = 0;
  for (const sale of sales) {
    try {
      // ¿Ya existe en Shopify? (una ejecución anterior pudo crearlo y cortarse antes de guardarlo)
      const found = await shopifyGraphql<{ orders: { nodes: { id: string; name: string }[] } }>(
        ORDER_BY_SOURCE,
        { query: posOrderSearchQuery(sale.id) },
        { requiredScopes: ['read_orders'] },
      );
      const existing = found.orders.nodes[0] ?? null;
      if (existing) {
        await markDone(admin, sale, existing);
        linked++;
        continue;
      }

      const lineItems = sale.sale_items
        .filter((i) => i.quantity > 0)
        .map((i) => {
          const variant = (i.variant_id && byVariant.get(i.variant_id)) || (i.product_id && byProduct.get(i.product_id));
          const unit = Number(i.total) / i.quantity;
          return variant
            ? { variantId: toGid(variant), quantity: i.quantity, priceSet: money(unit) }
            : { title: i.product_name, quantity: i.quantity, priceSet: money(unit), requiresShipping: false };
        });
      if (lineItems.length === 0) throw new Error('La venta no tiene artículos');

      const gateway = PAYMENT_LABEL[sale.payment_method ?? ''] ?? sale.payment_method ?? 'Tienda';
      const seller = sale.seller_employee_id ? sellerNames.get(sale.seller_employee_id) ?? null : null;
      const order: Record<string, unknown> = {
        currency,
        lineItems,
        taxesIncluded: true,
        financialStatus: 'PAID',
        fulfillmentStatus: 'FULFILLED',
        processedAt: sale.created_at,
        sourceIdentifier: sale.id,
        // El número de ticket va como etiqueta para buscar el pedido con el código de barras.
        tags: [POS_TAG, 'Venta en tienda', ...posTicketTags(sale.sale_number, seller)],
        customAttributes: posOrderAttributes(sale.sale_number, seller),
        note: [
          `Venta en tienda Pymova ${sale.sale_number}`,
          seller ? `Atendido por ${seller}` : null,
          sale.notes,
        ].filter(Boolean).join(' — '),
        transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway, amountSet: money(Number(sale.total)) }],
      };
      if (connection.default_location_gid) order.fulfillment = { locationId: connection.default_location_gid };

      const result = await shopifyGraphql<{
        orderCreate: { order: { id: string; name: string } | null; userErrors: { message: string }[] };
      }>(ORDER_CREATE, { order, options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false } }, { requiredScopes: ['write_orders'] });

      const errors = result.orderCreate.userErrors ?? [];
      if (errors.length || !result.orderCreate.order) throw new Error(errors.map((e) => e.message).join('; ') || 'Shopify no devolvió el pedido');

      await markDone(admin, sale, result.orderCreate.order);
      created++;
    } catch (error) {
      const attempts = sale.shopify_order_attempts + 1;
      await admin.from('sales').update({
        shopify_order_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        shopify_order_error: error instanceof Error ? error.message : 'Error desconocido',
        shopify_order_attempts: attempts,
        shopify_order_claimed_at: null,
      }).eq('id', sale.id);
      failed++;
    }
  }
  return { status: 'ok', created, linked, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const admin = serviceClient();

    // Tarea programada: sin JWT, con ticket de un solo uso; todos los negocios con pedidos de tienda.
    if (hasTicket(body)) {
      if (!(await consumeTicket(admin, body, 'pos-orders'))) return json({ error: 'No autorizado' }, 401);
      const { data: conns } = await admin
        .from('shopify_connections')
        .select('business_id')
        .eq('pos_orders_enabled', true)
        .is('uninstalled_at', null);
      const results = [];
      for (const c of conns ?? []) {
        try {
          results.push({ business_id: c.business_id, ...(await processBusiness(admin, c.business_id)) });
        } catch (error) {
          results.push({ business_id: c.business_id, error: error instanceof Error ? error.message : 'Error' });
        }
      }
      return json({ status: 'ok', results });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const businessId = String(body.business_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
    if (!isMember) return json({ error: 'Sin acceso a este negocio' }, 403);

    return json(await processBusiness(admin, businessId));
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, status);
  }
});
