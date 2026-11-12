// Lectura del número de ticket que escribe un lector de códigos de barras.
// Algunos lectores, con el teclado en español, cambian el guion por otro signo
// («VTA'000123»); por eso se aceptan separadores cualquiera y ceros de menos.

/** «vta'000123», «VTA000123», «VTA-123» o «123» → «VTA-000123». Null si no se reconoce. */
export function normalizeTicketCode(input: string): string | null {
  const match = /^([A-Z]{2,5})?[^A-Z0-9]*?0*(\d{1,9})$/.exec(input.trim().toUpperCase());
  if (!match) return null;
  const prefix = match[1] ?? 'VTA';
  return `${prefix}-${match[2].padStart(6, '0')}`;
}

/** Ticket de PYMOVA (venta VTA-… o devolución DEV-…); null si es de otro sistema o no se reconoce. */
export function pymovaTicketCode(input: string): string | null {
  const code = normalizeTicketCode(input);
  return code && /^(VTA|DEV)-/.test(code) ? code : null;
}

/**
 * Lo escrito o escaneado, sin separadores ni minúsculas, y sin el prefijo de la caja que el
 * código de barras de Stockagile pone delante («ND1.VT2510383» → «VT2510383»).
 */
function stockagileCleanCode(input: string): string {
  const parts = input.trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.length > 1 && /^ND\d*$/.test(parts[0])) parts.shift();
  // Si el lector no escribe el separador, el prefijo va pegado a la «VT».
  return parts.join('').replace(/^ND\d*(?=VT\d)/, '');
}

/**
 * Ticket de Stockagile: «VT2510383» (VT, año y número) o, en los más antiguos, solo cifras.
 * Admite el código de barras del ticket («ND1.VT2510383»), minúsculas y separadores
 * cambiados por el teclado. Null si no lo parece.
 */
export function stockagileTicketCode(input: string): string | null {
  const code = stockagileCleanCode(input);
  return /^(VT\d{4,9}|\d{5,9})$/.test(code) ? code : null;
}

/** ¿Contiene el número de un ticket de Stockagile lo escrito (sin separadores ni mayúsculas)? */
export function matchesStockagileNumber(number: string | null, query: string): boolean {
  const q = stockagileCleanCode(query);
  if (!q) return true;
  return !!number && number.toUpperCase().includes(q);
}
