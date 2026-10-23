// Registra en Shopify el reembolso de cada devolución de tienda (TPV) cuyo pedido ya existe allí.
// El stock lo ajusta shopify-inventory-push, por eso las líneas van con restockType NO_RESTOCK.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getShopDomain, serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';
import { storeBusinessIds, storeConnection } from '../_shared/shopify-connection.ts';
import {
  findRefundLine, planRefundTransactions, refundAmountForReturn, shopifyTag, type ShopifyOrderTransaction,
} from '../_shared/shopify-core.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';
import { loadLevelsFor } from '../_shared/shopify-levels.ts';
import { levelPages } from '../_shared/shopify-levels-db.ts';

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
      transactions(first: 50) { id kind status gateway amountSet { shopMoney { amount } } parentTransaction { id } }
    }
  }
`;

const TAGS_ADD = `
  mutation PosReturnTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
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

/** Registra en Shopify los reembolsos pendientes de un negocio. */
async function processBusiness(admin: SupabaseClient, businessId: string): Promise<Record<string, unknown>> {
  // Solo la conexión de la tienda de este despliegue (S1): un dominio cualquiera no basta.
  const connection = await storeConnection<{ pos_orders_enabled: boolean }>(
    admin, businessId, getShopDomain(), 'pos_orders_enabled',
  );
  if (!connection?.pos_orders_enabled) return { status: 'skipped' };

  const { data: returnsData } = await admin
    .from('sale_returns')
    .select('id, sale_id, return_number, reason, total, seller_employee_id, shopify_refund_attempts, sales!inner(shopify_order_gid, sale_number, total), sale_return_items(product_id, variant_id, product_name, quantity, unit_price, total)')
    .eq('business_id', businessId)
    .is('shopify_refund_gid', null)
    .not('sales.shopify_order_gid', 'is', null)
    .lt('shopify_refund_attempts', MAX_ATTEMPTS)
    .eq('shopify_refund_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20);
  interface ReturnRow {
    id: string;
    sale_id: string;
    return_number: string;
    reason: string | null;
    total: number | string;
    seller_employee_id: string | null;
    shopify_refund_attempts: number;
    sales: { shopify_order_gid: string | null; sale_number: string; total: number | string };
    sale_return_items: { product_id: string | null; variant_id: string | null; product_name: string; quantity: number; unit_price: number; total: number | null }[];
  }
  const returns = (returnsData ?? []) as unknown as ReturnRow[];
  if (returns.length === 0) return { status: 'ok', created: 0, failed: 0 };

  // Solo los emparejamientos de los artículos devueltos (la tabla entera pasa de las 1.000 filas).
  const items = returns.flatMap((r) => r.sale_return_items);
  const levels = await loadLevelsFor<{
    id: string;
    variant_external_id: string | null;
    local_variant_id: string | null;
    local_product_id: string | null;
  }>(levelPages(admin, businessId, 'variant_external_id, local_variant_id, local_product_id'), {
    variantIds: items.map((i) => i.variant_id),
    productIds: items.map((i) => i.product_id),
  });
  const byVariant = new Map<string, string>();
  const byProduct = new Map<string, string>();
  for (const l of levels) {
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
          transactions: ShopifyOrderTransaction[];
        } | null;
      }>(ORDER_QUERY, { id: orderGid }, { requiredScopes: ['read_orders'] });
      if (!data.order) throw new Error('El pedido ya no existe en Shopify');

      const available = new Map(data.order.lineItems.nodes.map((n) => [n.id, n.quantity]));
      const refundLineItems: { lineItemId: string; quantity: number; restockType: string }[] = [];
      for (const item of ret.sale_return_items as { product_id: string | null; variant_id: string | null; product_name: string; quantity: number }[]) {
        const variantGid = (item.variant_id && byVariant.get(item.variant_id)) || (item.product_id && byProduct.get(item.product_id));
        const line = findRefundLine(data.order.lineItems.nodes, available, { variantGid, productName: item.product_name });
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

      const sellerName = ret.seller_employee_id
        ? ((await admin.rpc('employee_display_name', { _employee_id: ret.seller_employee_id })).data as string | null)
        : null;

      const input: Record<string, unknown> = {
        orderId: orderGid,
        note: [
          `Devolución en tienda Pymova ${ret.return_number}`,
          sellerName ? `Atendido por ${sellerName}` : null,
          ret.reason,
        ].filter(Boolean).join(' — '),
        notify: false,
        refundLineItems,
      };
      // Reparte el importe entre los cobros del pedido (p. ej. tarjeta y vale de tienda).
      const plan = amount > 0 ? planRefundTransactions(data.order.transactions, amount) : [];
      if (plan.length) {
        input.transactions = plan.map((t) => ({
          orderId: orderGid, parentId: t.parentId, kind: 'REFUND', gateway: t.gateway, amount: t.amount.toFixed(2),
        }));
      }

      const result = await shopifyGraphql<{
        refundCreate: { refund: { id: string } | null; userErrors: { message: string }[] };
      }>(REFUND_CREATE, { input, key: ret.id }, { requiredScopes: ['write_orders'] });
      const errors = result.refundCreate.userErrors ?? [];
      if (errors.length || !result.refundCreate.refund) throw new Error(errors.map((e) => e.message).join('; ') || 'Shopify no devolvió el reembolso');

      // El número de la devolución como etiqueta del pedido: su ticket también lo encuentra.
      // Si falla, el reembolso ya está hecho y no se repite.
      const returnTag = shopifyTag(ret.return_number);
      if (returnTag) {
        try {
          await shopifyGraphql(TAGS_ADD, { id: orderGid, tags: [returnTag] }, { requiredScopes: ['write_orders'] });
        } catch (tagError) {
          console.error('No se pudo etiquetar la devolución', tagError instanceof Error ? tagError.message : tagError);
        }
      }

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
  return { status: 'ok', created, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const admin = serviceClient();

    // Tarea programada: sin JWT, con ticket de un solo uso; todos los negocios con pedidos de tienda.
    if (hasTicket(body)) {
      if (!(await consumeTicket(admin, body, 'pos-refunds'))) return json({ error: 'No autorizado' }, 401);
      const ids = await storeBusinessIds(admin, getShopDomain(), 'pos_orders_enabled');
      const results = [];
      for (const id of ids) {
        try {
          results.push({ business_id: id, ...(await processBusiness(admin, id)) });
        } catch (error) {
          results.push({ business_id: id, error: error instanceof Error ? error.message : 'Error' });
        }
      }
      return json({ status: 'ok', results });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
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
