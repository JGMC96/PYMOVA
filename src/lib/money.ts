// Importes en la moneda del negocio. La app nació con pesos mexicanos fijos en el
// código; ahora cada negocio tiene su moneda (businesses.currency) y aquí se formatea.

export const DEFAULT_CURRENCY = 'EUR';

/** Configuración regional con la que se escribe cada moneda (separadores y símbolo). */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  EUR: 'es-ES',
  MXN: 'es-MX',
  USD: 'en-US',
  GBP: 'en-GB',
};

export function currencyLocale(currency: string): string {
  return LOCALE_BY_CURRENCY[currency.toUpperCase()] ?? 'es-ES';
}

/** Importe con símbolo: 145 → «145,00 €» en EUR, «$145.00» en MXN. */
export function formatMoney(amount: number | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  const value = Number(amount);
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
  try {
    return new Intl.NumberFormat(currencyLocale(code), { style: 'currency', currency: code }).format(
      Number.isFinite(value) ? value : 0,
    );
  } catch {
    // Código de moneda desconocido: no rompemos la pantalla.
    return `${(Number.isFinite(value) ? value : 0).toFixed(2)} ${code}`;
  }
}
