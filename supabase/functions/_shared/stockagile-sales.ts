// Ventas de la tienda hechas en Stockagile → copia de consulta en PYMOVA (0046). Sin
// dependencias de Deno para probarlo con Vitest. No son ventas de PYMOVA: no mueven stock ni
// crean pedidos en Shopify.

export interface StockagilePosOrder {
  id: number;
  autocode?: string | null;
  created_at: string;
  deleted?: boolean;
  is_devolution?: boolean;
  devolution_of?: number | null;
  is_negative?: boolean;
  negative_of?: number | null;
  total?: number | string | null;
  /** Pedido de la tienda online (esos ya llegan por Shopify): se ignora. */
  site?: number | null;
  source_warehouse?: { name?: string | null } | null;
  customer?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    commercial_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  pos_order_payment_methods?: { payment_method_name?: string | null; amount?: number | null }[] | null;
  pos_order_product_variants?: {
    product_name?: string | null;
    product_variant_size_name?: string | null;
    product_variant_color_name?: string | null;
    barcode?: string | null;
    amount?: number | null;
    price_incl_tax?: number | null;
    discount_price_incl_tax?: number | null;
    custom_price_incl_tax?: number | null;
    total?: string | number | null;
    deleted?: boolean;
  }[] | null;
}

export interface StockagileSaleRow {
  business_id: string;
  external_id: number;
  number: string;
  sold_at: string;
  warehouse_name: string | null;
  total: number;
  is_return: boolean;
  return_of_external_id: number | null;
  deleted: boolean;
  payment_methods: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  synced_at: string;
}

export interface StockagileSaleItemRow {
  product_name: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  quantity: number;
  unit_price: number | null;
  total: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (s: string | null | undefined) => (s ?? '').trim() || null;
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** ¿Es un ticket de la tienda (no un pedido de la web)? */
export function isStoreOrder(o: StockagilePosOrder): boolean {
  return o.site === null || o.site === undefined;
}

/** Nombre de la clienta como lo guarda Stockagile. */
export function customerName(c: StockagilePosOrder['customer']): string | null {
  if (!c) return null;
  return text(c.name) ?? text([c.first_name, c.last_name].filter(Boolean).join(' ')) ?? text(c.commercial_name);
}

/** Ticket de Stockagile → fila de stockagile_sales y sus líneas. */
export function mapPosOrder(
  businessId: string,
  o: StockagilePosOrder,
  now = new Date().toISOString(),
): { sale: StockagileSaleRow; items: StockagileSaleItemRow[] } {
  const methods = (o.pos_order_payment_methods ?? [])
    .map((m) => text(m.payment_method_name))
    .filter((m): m is string => !!m);
  const sale: StockagileSaleRow = {
    business_id: businessId,
    external_id: o.id,
    number: text(o.autocode) ?? String(o.id),
    sold_at: o.created_at,
    warehouse_name: text(o.source_warehouse?.name),
    total: round2(num(o.total) ?? 0),
    is_return: !!(o.is_devolution || o.is_negative),
    return_of_external_id: o.devolution_of ?? o.negative_of ?? null,
    deleted: !!o.deleted,
    payment_methods: methods.length ? [...new Set(methods)].join(' · ') : null,
    customer_name: customerName(o.customer),
    customer_email: text(o.customer?.email)?.toLowerCase() ?? null,
    customer_phone: text(o.customer?.phone),
    synced_at: now,
  };
  const items = (o.pos_order_product_variants ?? [])
    .filter((l) => !l.deleted)
    .map((l) => {
      const name = text(l.product_name) ?? 'Artículo';
      const size = text(l.product_variant_size_name);
      const quantity = Math.trunc(num(l.amount) ?? 0);
      const total = num(l.total);
      const unit = num(l.custom_price_incl_tax) ?? num(l.discount_price_incl_tax) ?? num(l.price_incl_tax)
        ?? (total !== null && quantity ? total / quantity : null);
      return {
        // Con la talla en el nombre («… - 39»), como los pedidos web, para la talla habitual.
        product_name: size ? `${name} - ${size}` : name,
        size,
        color: text(l.product_variant_color_name),
        barcode: text(l.barcode),
        quantity,
        unit_price: unit === null ? null : round2(unit),
        total: total === null ? null : round2(total),
      };
    });
  return { sale, items };
}
