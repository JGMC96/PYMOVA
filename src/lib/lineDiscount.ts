// Descuento de una línea del TPV: en %, en € o escribiendo el precio final de la línea.
// Siempre es un descuento sobre el precio del catálogo (no cambia el precio del producto): la
// línea va a la venta con su total neto y el servidor deduce el descuento (bruto − neto), así
// cuentan igual el informe de descuentos, el margen, el máximo de cada vendedor y Shopify.

export type LineDiscountMode = 'pct' | 'eur' | 'price';

export interface LineDiscount {
  mode: LineDiscountMode;
  /** Lo escrito: «15», «26,50» o, en modo precio, el total final de la línea («139»). */
  value: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Número escrito con coma o punto decimal; null si está vacío o no es un número. */
export function parseAmount(raw: string | undefined): number | null {
  const clean = (raw ?? '').trim().replace(/\s|€|%/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** Descuento en € de una línea con total bruto `lineTotal`. Nunca negativo ni mayor que el bruto. */
export function lineDiscountAmount(lineTotal: number, discount: LineDiscount | null | undefined): number {
  if (!discount || !(lineTotal > 0)) return 0;
  const value = parseAmount(discount.value);
  if (value === null) return 0;
  let amount: number;
  if (discount.mode === 'pct') amount = (lineTotal * Math.min(Math.max(value, 0), 100)) / 100;
  else if (discount.mode === 'eur') amount = value;
  else amount = lineTotal - value; // precio final de la línea
  return round2(Math.min(Math.max(amount, 0), lineTotal));
}

/** % de descuento de la línea, para enseñarlo (dos decimales). */
export function lineDiscountPct(lineTotal: number, amount: number): number {
  if (!(lineTotal > 0) || !(amount > 0)) return 0;
  return Math.round((amount / lineTotal) * 10000) / 100;
}

/** Precio final escrito para una línea → su descuento; null si no hay descuento (vacío o igual al bruto). */
export function finalPriceDiscount(lineTotal: number, raw: string): LineDiscount | null {
  const value = parseAmount(raw);
  if (value === null || round2(value) >= round2(lineTotal)) return null;
  return { mode: 'price', value: String(round2(Math.max(value, 0))) };
}
