// Registra en Shopify el reembolso de cada devolución de tienda (TPV) cuyo pedido ya existe allí.
// El stock lo ajusta shopify-inventory-push, por eso las líneas van con restockType NO_RESTOCK.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';
import { refundAmountForReturn } from '../_shared/shopify-core.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MAX_ATTEMPTS = 5;

/** La devolución no cuadra con sus líneas: no se reintenta. */
class IntegrityError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ORDER_QUERY = `
  query PosOrder($id: ID!) {
    order(id: $id) {
      id
      lineItems(first: 100) { nodes { id title quantity variant { id } } }
      transactions(first: 20) { id kind status gateway }
    }
  }
`;

const REFUND_CREATE = `
  mutation PosRefund($input: RefundInput!, $key: String!) {
    refundCreate(input: $input) @idempotent(key: $key) {
      refund { id }
      userErrors { field message }
    }
  }
`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body.business_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json({ error: 'Falta el negocio activo' }, 400);
    const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
    if (!isMember) return json({ error: 'Sin acceso a este negocio' }, 403);

    const admin = serviceClient();
    const { data: connection } = await admin
      .from('shopify_connections').select('pos_orders_enabled').eq('business_id', businessId).maybeSingle();
    if (!connection?.pos_orders_enabled) return json({ status: 'skipped' });

    const { data: returnsData } = await admin
      .from('sale_returns')
      .select('id, sale_id, return_number, reason, total, shopify_refund_attempts, sales!inner(shopify_order_gid, sale_number, total), sale_return_items(product_id, variant_id, product_name, quantity, unit_price, total)')
      .eq('business_id', businessId)
      .is('shopify_refund_gid', null)
      .not('sales.shopify_order_gid', 'is', null)
      .lt('shopify_refund_attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(20);
    interface ReturnRow {
      id: string;
      sale_id: string;
      return_number: string;
      reason: string | null;
      total: number | string;
      shopify_refund_attempts: number;
      sales: { shopify_order_gid: string | null; sale_number: string; total: number | string };
      sale_return_items: { product_id: string | null; variant_id: string | null; product_name: string; quantity: number; unit_price: number; total: number | null }[];
    }
    const returns = (returnsData ?? []) as unknown as ReturnRow[];
    if (returns.length === 0) return json({ status: 'ok', created: 0, failed: 0 });

    const { data: levels } = await admin
      .from('shopify_inventory_levels')
      .select('variant_external_id, local_variant_id, local_product_id')
      .eq('business_id', businessId);
    const byVariant = new Map<string, string>();
    const byProduct = new Map<string, string>();
    for (const l of levels ?? []) {
      if (!l.variant_external_id) continue;
      const gid = l.variant_external_id.startsWith('gid://') ? l.variant_external_id : `gid://shopify/ProductVariant/${l.variant_external_id}`;
      if (l.local_variant_id) byVariant.set(l.local_variant_id, gid);
      else if (l.local_product_id) byProduct.set(l.local_product_id, gid);
    }

    let created = 0;
    let failed = 0;
    for (const ret of returns) {
      try {
        const orderGid = ret.sales.shopify_order_gid as string;
        const data = await shopifyGraphql<{
          order: {
            id: string;
            lineItems: { nodes: { id: string; title: string; quantity: number; variant: { id: string } | null }[] };
            transactions: { id: string; kind: string; status: string; gateway: string }[];
          } | null;
        }>(ORDER_QUERY, { id: orderGid }, { requiredScopes: ['read_orders'] });
        if (!data.order) throw new Error('El pedido ya no existe en Shopify');

        const available = new Map(data.order.lineItems.nodes.map((n) => [n.id, n.quantity]));
        const refundLineItems: { lineItemId: string; quantity: number; restockType: string }[] = [];
        for (const item of ret.sale_return_items as { product_id: string | null; variant_id: string | null; product_name: string; quantity: number }[]) {
          const variantGid = (item.variant_id && byVariant.get(item.variant_id)) || (item.product_id && byProduct.get(item.product_id));
          const line = data.order.lineItems.nodes.find((n) =>
            (available.get(n.id) ?? 0) > 0 && (variantGid ? n.variant?.id === variantGid : n.title === item.product_name));
          if (!line) continue;
          const qty = Math.min(Number(item.quantity), available.get(line.id) ?? 0);
          available.set(line.id, (available.get(line.id) ?? 0) - qty);
          refundLineItems.push({ lineItemId: line.id, quantity: qty, restockType: 'NO_RESTOCK' });
        }

        // El importe sale de las líneas y nunca supera lo pendiente de la venta;
        // una devolución cuyo total no cuadre no se reembolsa.
        const { data: previas } = await admin
          .from('sale_returns')
          .select('total')
          .eq('sale_id', ret.sale_id)
          .neq('id', ret.id)
          .not('shopify_refund_gid', 'is', null);
        const alreadyRefunded = (previas ?? []).reduce((sum, r) => sum + Number(r.total), 0);
        const amount = refundAmountForReturn(ret.sale_return_items, Number(ret.sales.total), alreadyRefunded);
        if (Math.abs(amount - Number(ret.total)) > 0.01) {
          throw new IntegrityError(
            `El importe de la devolución (${Number(ret.total).toFixed(2)}) no cuadra con sus líneas (${amount.toFixed(2)})`,
          );
        }

        const parent = data.order.transactions.find((t) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS');
        const input: Record<string, unknown> = {
          orderId: orderGid,
          note: [`Devolución en tienda Pymova ${ret.return_number}`, ret.reason].filter(Boolean).join(' — '),
          notify: false,
          refundLineItems,
        };
        if (parent && amount > 0) {
          input.transactions = [{
            orderId: orderGid, parentId: parent.id, kind: 'REFUND', gateway: parent.gateway,
            amount: amount.toFixed(2),
          }];
        }

        const result = await shopifyGraphql<{
          refundCreate: { refund: { id: string } | null; userErrors: { message: string }[] };
        }>(REFUND_CREATE, { input, key: ret.id }, { requiredScopes: ['write_orders'] });
        const errors = result.refundCreate.userErrors ?? [];
        if (errors.length || !result.refundCreate.refund) throw new Error(errors.map((e) => e.message).join('; ') || 'Shopify no devolvió el reembolso');

        await admin.from('sale_returns').update({
          shopify_refund_gid: result.refundCreate.refund.id,
          shopify_refund_status: 'done',
          shopify_refund_error: null,
          shopify_refund_attempts: ret.shopify_refund_attempts + 1,
        }).eq('id', ret.id);
        created++;
      } catch (error) {
        const attempts = error instanceof IntegrityError ? MAX_ATTEMPTS : ret.shopify_refund_attempts + 1;
        await admin.from('sale_returns').update({
          shopify_refund_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          shopify_refund_error: error instanceof Error ? error.message : 'Error desconocido',
          shopify_refund_attempts: attempts,
        }).eq('id', ret.id);
        failed++;
      }
    }
    return json({ status: 'ok', created, failed });
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, status);
  }
});
