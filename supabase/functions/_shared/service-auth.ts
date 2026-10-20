// Llamadas de servicio (tareas programadas con pg_cron).
// La pasarela de Supabase ya ha verificado la firma del JWT (verify_jwt = true en
// config.toml); aquí solo se lee su rol. No usar en funciones con verify_jwt = false.

function decodeBase64Url(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Rol del JWT de la cabecera Authorization («Bearer …»), o null si no se puede leer. */
export function jwtRole(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const parts = authHeader.slice('Bearer '.length).trim().split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(decodeBase64Url(parts[1])) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

/** La petición viene con la clave de servicio (por ejemplo, desde una tarea pg_cron). */
export function isServiceRoleRequest(authHeader: string | null | undefined): boolean {
  return jwtRole(authHeader) === 'service_role';
}
