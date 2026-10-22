// Importación del historial de pedidos: piezas sin dependencias de Deno para probarlas.
import type { ShopifyCustomer } from './shopify-customers.ts';

interface OrderWithCustomer {
  customer: { id?: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
}

/** Nombre del artículo con su talla («Zueco Rio Tira Pelo Cow - 38»), para la ficha de clienta. */
export function lineItemName(title: string, variantTitle?: string | null): string {
  const v = variantTitle?.trim();
  return v && v !== 'Default Title' ? `${title} - ${v}` : title;
}

/** Quien compró en cada pedido, una vez por clienta (los pedidos sin clienta de Shopify, fuera). */
export function historyBuyers(orders: OrderWithCustomer[]): ShopifyCustomer[] {
  const byId = new Map<string, ShopifyCustomer>();
  for (const o of orders) {
    const c = o.customer;
    if (!c?.id || byId.has(c.id)) continue;
    byId.set(c.id, { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone });
  }
  return [...byId.values()];
}
