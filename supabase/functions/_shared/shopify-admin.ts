export const SHOPIFY_API_VERSION = '2025-07';

export function getShopDomain(): string {
  return Deno.env.get('SHOPIFY_STORE_DOMAIN') ?? 'tuilus-shop.myshopify.com';
}

export function getAdminToken(): string {
  const onlineTokenEntry = Object.entries(Deno.env.toObject()).find(([name, value]) =>
    name.startsWith('SHOPIFY_ONLINE_ACCESS_TOKEN:') && Boolean(value)
  );
  const token = onlineTokenEntry?.[1] ?? Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!token) throw new Error('Falta el token de administración de Shopify (SHOPIFY_ACCESS_TOKEN).');
  return token;
}

export async function adminGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `https://${getShopDomain()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': getAdminToken(),
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`Shopify Admin API ${response.status}: ${detail}`);
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        response.status === 401
          ? 'La sesión de Shopify ha caducado o no es válida. Vuelve a conectar la cuenta de Shopify.'
          : 'Shopify no ha concedido los permisos read_orders y write_orders necesarios para gestionar pedidos.',
      );
    }
    throw new Error(`Error HTTP de Shopify Admin API: ${response.status} ${detail.slice(0, 300)}`);
  }

  const json = await response.json();
  if (json.errors) {
    const message = Array.isArray(json.errors)
      ? json.errors.map((e: { message: string }) => e.message).join(', ')
      : JSON.stringify(json.errors);
    throw new Error(`Error de Shopify Admin API: ${message}`);
  }
  return json.data as T;
}

const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  createdAt
  updatedAt
  cancelledAt
  note
  email
  phone
  displayFinancialStatus
  displayFulfillmentStatus
  customer { firstName lastName email phone }
  shippingAddress { name address1 address2 city zip province country }
  currentSubtotalPriceSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  currentTotalDiscountsSet { shopMoney { amount } }
  currentTotalPriceSet { shopMoney { amount } }
  fulfillments(first: 10) { trackingInfo { number } }
  lineItems(first: 100) {
    edges {
      node {
        id
        title
        quantity
        sku
        variant { id sku barcode }
        originalUnitPriceSet { shopMoney { amount } }
        discountedTotalSet { shopMoney { amount } }
      }
    }
  }
`;

export const ORDERS_QUERY = `
  query SyncOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${ORDER_FIELDS} } }
    }
  }
`;

export const ORDER_BY_ID_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
`;

export interface ShopifyAdminOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  note: string | null;
  email: string | null;
  phone: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  shippingAddress: Record<string, string | null> | null;
  currentSubtotalPriceSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  currentTotalTaxSet: { shopMoney: { amount: string } } | null;
  currentTotalDiscountsSet: { shopMoney: { amount: string } } | null;
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  fulfillments: Array<{ trackingInfo: Array<{ number: string | null }> }>;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        quantity: number;
        sku: string | null;
        variant: { id: string; sku: string | null; barcode: string | null } | null;
        originalUnitPriceSet: { shopMoney: { amount: string } } | null;
        discountedTotalSet: { shopMoney: { amount: string } } | null;
      };
    }>;
  };
}

export type LocalOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export function mapOrderStatus(order: ShopifyAdminOrder): LocalOrderStatus {
  if (order.cancelledAt) return 'cancelled';
  if (order.displayFinancialStatus === 'REFUNDED') return 'returned';
  switch (order.displayFulfillmentStatus) {
    case 'FULFILLED':
return 'shipped';
    case 'PARTIALLY_FULFILLED':
    case 'IN_PROGRESS':
      return 'preparing';
    default:
      return order.displayFinancialStatus === 'PAID' ? 'accepted' : 'pending';
  }
}

const num = (value?: { shopMoney: { amount: string } } | null) => Number(value?.shopMoney?.amount ?? 0) || 0;

export function mapPaymentStatus(order: ShopifyAdminOrder): string {
  switch (order.displayFinancialStatus) {
    case 'PAID':
      return 'paid';
    case 'PARTIALLY_PAID':
      return 'partial';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'refunded';
    case 'VOIDED':
      return 'voided';
    default:
      return 'pending';
  }
}

export function formatAddress(order: ShopifyAdminOrder): string | null {
  const a = order.shippingAddress;
  if (!a) return null;
  return [a.address1, a.address2, a.zip, a.city, a.province, a.country]
    .filter(Boolean)
    .join(', ') || null;
}

export function buildUpsertArgs(businessId: string, order: ShopifyAdminOrder) {
  const customerName =
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ').trim() ||
    (order.shippingAddress?.name ?? '') ||
    order.email ||
    'Cliente Shopify';

  const items = order.lineItems.edges.map(({ node }) => ({
    product_id: null,
    variant_id: null,
    product_name: node.title,
    quantity: node.quantity,
    unit_price: num(node.originalUnitPriceSet),
    total: num(node.discountedTotalSet) || num(node.originalUnitPriceSet) * node.quantity,
  }));

  const tracking =
    order.fulfillments.flatMap((f) => f.trackingInfo.map((t) => t.number)).filter(Boolean)[0] ?? null;

  return {
    _business_id: businessId,
    _source: 'shopify',
    _external_id: order.id,
    _order_number: order.name,
    _customer_name: customerName,
    _customer_email: order.customer?.email ?? order.email,
    _customer_phone: order.customer?.phone ?? order.phone,
    _shipping_address: formatAddress(order),
    _status: mapOrderStatus(order),
    _payment_status: mapPaymentStatus(order),
    _payment_method: 'shopify',
    _subtotal: num(order.currentSubtotalPriceSet),
    _shipping_cost: num(order.totalShippingPriceSet),
    _tax: num(order.currentTotalTaxSet),
    _discount: num(order.currentTotalDiscountsSet),
    _total: num(order.currentTotalPriceSet),
    _tracking_number: tracking,
    _notes: order.note,
    _items: items,
    _external_updated_at: order.updatedAt,
  };
}
