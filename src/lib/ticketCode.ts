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
 * Ticket de Stockagile: «VT2510383» (VT, año y número) o, en los más antiguos, solo cifras.
 * Sin separadores ni minúsculas, por si el lector cambia algún signo. Null si no lo parece.
 */
export function stockagileTicketCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^(VT\d{4,9}|\d{5,9})$/.test(code) ? code : null;
}

/** ¿Contiene el número de un ticket de Stockagile lo escrito (sin separadores ni mayúsculas)? */
export function matchesStockagileNumber(number: string | null, query: string): boolean {
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) return true;
  return !!number && number.toUpperCase().includes(q);
}
