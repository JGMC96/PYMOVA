// Tareas programadas (pg_cron): no llevan JWT. Cada llamada trae en el cuerpo un ticket
// de un solo uso creado por la propia tarea (issue_scheduled_job_ticket). Aquí se gasta:
// solo vale una vez, para su acción y durante 10 minutos.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El cuerpo trae un ticket con forma de uuid? (si no, la llamada es de un usuario) */
export function hasTicket(body: Record<string, unknown>): boolean {
  return typeof body.ticket === 'string' && UUID.test(body.ticket);
}

/** Gasta el ticket para esa acción. Devuelve true solo si era válido. */
export async function consumeTicket(
  admin: SupabaseClient,
  body: Record<string, unknown>,
  action: string,
): Promise<boolean> {
  if (!hasTicket(body)) return false;
  const { data, error } = await admin.rpc('consume_scheduled_job_ticket', {
    _ticket: body.ticket as string,
    _action: action,
  });
  return !error && data === true;
}
