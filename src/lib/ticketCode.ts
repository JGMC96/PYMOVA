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
