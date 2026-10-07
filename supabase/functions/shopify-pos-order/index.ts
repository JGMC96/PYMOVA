// Crea en Shopify un pedido por cada venta de tienda (TPV) de Pymova.
// El stock ya lo ajusta shopify-inventory-push, por eso el pedido se crea con inventoryBehaviour BYPASS.
// Los pedidos llevan la etiqueta POS_TAG para que la traída de pedidos online los ignore.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';

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
  shopify_order_attempts: number;
  sale_items: Array<{
    product_id: string | null;
    variant_id: string | null;
    product_name: string;
    quantity: number;
    total: number;
  }>;
}

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
    const businessId = String(body.business_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
    if (!isMember) return json({ error: 'Sin acceso a este negocio' }, 403);

    const admin = serviceClient();
    const { data: connection } = await admin
      .from('shopify_connections')
      .select('pos_orders_enabled, pos_orders_since, default_location_gid')
      .eq('business_id', businessId)
      .maybeSingle();
    if (!connection) return json({ status: 'skipped', reason: 'Sin tienda de Shopify vinculada' });
    if (!connection.pos_orders_enabled) return json({ status: 'skipped', reason: 'Pedidos de tienda desactivados' });

    const { data: salesData } = await admin
      .from('sales')
      .select('id, sale_number, total, tip, payment_method, notes, created_at, shopify_order_attempts, sale_items(product_id, variant_id, product_name, quantity, total)')
      .eq('business_id', businessId)
      .is('shopify_order_gid', null)
      .gte('created_at', connection.pos_orders_since)
      .lt('shopify_order_attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);
    const sales = (salesData ?? []) as unknown as SaleRow[];
    if (sales.length === 0) return json({ status: 'ok', created: 0, failed: 0 });

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

    let created = 0;
    let failed = 0;
    for (const sale of sales) {
      try {
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
        const order: Record<string, unknown> = {
          currency,
          lineItems,
          taxesIncluded: true,
          financialStatus: 'PAID',
          fulfillmentStatus: 'FULFILLED',
          processedAt: sale.created_at,
          sourceIdentifier: sale.id,
          tags: [POS_TAG, 'Venta en tienda'],
          note: [`Venta en tienda Pymova ${sale.sale_number}`, sale.notes].filter(Boolean).join(' — '),
          transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway, amountSet: money(Number(sale.total)) }],
        };
        if (connection.default_location_gid) order.fulfillment = { locationId: connection.default_location_gid };

        const result = await shopifyGraphql<{
          orderCreate: { order: { id: string; name: string } | null; userErrors: { message: string }[] };
        }>(ORDER_CREATE, { order, options: { inventoryBehaviour: 'BYPASS', sendReceipt: false, sendFulfillmentReceipt: false } }, { requiredScopes: ['write_orders'] });

        const errors = result.orderCreate.userErrors ?? [];
        if (errors.length || !result.orderCreate.order) throw new Error(errors.map((e) => e.message).join('; ') || 'Shopify no devolvió el pedido');

        await admin.from('sales').update({
          shopify_order_gid: result.orderCreate.order.id,
          shopify_order_name: result.orderCreate.order.name,
          shopify_order_status: 'done',
          shopify_order_error: null,
          shopify_order_attempts: sale.shopify_order_attempts + 1,
        }).eq('id', sale.id);
        created++;
      } catch (error) {
        const attempts = sale.shopify_order_attempts + 1;
        await admin.from('sales').update({
          shopify_order_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          shopify_order_error: error instanceof Error ? error.message : 'Error desconocido',
          shopify_order_attempts: attempts,
        }).eq('id', sale.id);
        failed++;
      }
    }
    return json({ status: 'ok', created, failed });
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, status);
  }
});
