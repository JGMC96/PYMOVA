// Precio anterior de Shopify (`compareAtPrice`, 0061): rebajas puestas en Shopify bajando el
// precio. Es solo para enseñarlo; lo cobrado es siempre el precio actual.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Precio anterior si de verdad es una rebaja (mayor que el actual); si no, null. */
export function promoListPrice(price: number | null | undefined, compareAt: number | string | null | undefined): number | null {
  const list = compareAt == null || compareAt === '' ? NaN : Number(compareAt);
  const now = Number(price);
  return Number.isFinite(list) && Number.isFinite(now) && list > now ? round2(list) : null;
}

/** % de rebaja redondeado a la unidad: 179 → 143,20 es un 20 %. */
export function promoPct(price: number, listPrice: number): number {
  return listPrice > 0 ? Math.round((1 - price / listPrice) * 100) : 0;
}

/** Precio anterior de lo que se vende: el de la talla o, si no tiene tallas, el del producto. */
export function catalogCompareAt(
  product: { price: number; compare_at_price?: number | null },
  variant?: { price: number | null; compare_at_price?: number | null } | null,
): number | null {
  if (variant) return promoListPrice(variant.price ?? product.price, variant.compare_at_price);
  return promoListPrice(product.price, product.compare_at_price);
}

/** Lo que se ahorra en una línea por la rebaja de Shopify (sin contar el descuento del TPV). */
export function promoSavings(line: { quantity: number; unitPrice: number; listPrice?: number | null }): number {
  return line.listPrice && line.listPrice > line.unitPrice ? round2((line.listPrice - line.unitPrice) * line.quantity) : 0;
}
