// IVA incluido en el precio: el precio del catálogo es el precio final que paga
// el cliente. La base imponible y la cuota se deducen del total.

/** Tipo por defecto cuando el negocio aún no tiene ajustes (España). */
export const DEFAULT_TAX_RATE = 21;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Base imponible y cuota a partir de un total con IVA incluido. */
export function taxBreakdown(total: number, rate: number) {
  const base = round2(total / (1 + rate / 100));
  return { base, tax: round2(total - base) };
}

/**
 * Totales de una venta a partir de los totales netos de línea (ya con
 * descuento y con IVA incluido): lo que paga el cliente, su base y su IVA.
 */
export function saleTotals(lineTotals: number[], rate: number) {
  const total = round2(lineTotals.reduce((sum, n) => sum + n, 0));
  const { base, tax } = taxBreakdown(total, rate);
  return { total, base, tax };
}
