// Ofuscación de datos personales para los logs de las edge functions.
// Los logs de Deno son persistentes: nunca se escribe un correo completo ni un token.

/** Correo enmascarado: primera letra y dominio (a***@dominio.com). */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return 'unknown';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Token enmascarado: solo los 4 primeros caracteres, para poder correlacionar. */
export function redactToken(token: string | null | undefined): string {
  if (!token) return 'unknown';
  return `${token.slice(0, 4)}…(${token.length})`;
}
