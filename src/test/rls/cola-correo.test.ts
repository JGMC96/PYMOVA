// @vitest-environment node
// La cola de correo solo la usan las edge functions con la clave de servicio y pg_cron.
// Ni anon ni authenticated pueden encolar, leer, borrar ni mover correos, ni disparar el
// procesado (en producción podían, por los privilegios por defecto de Supabase).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const FUNCIONES = [
  'public.enqueue_email(text, jsonb)',
  'public.read_email_batch(text, integer, integer)',
  'public.delete_email(text, bigint)',
  'public.move_to_dlq(text, text, bigint, jsonb)',
];
const MIGRACION = join(__dirname, '../../../drizzle/migrations/0031_cola_correo_permisos.sql');

describe.skipIf(!RLS_DB_URL)('RLS · cola de correo solo para el servidor', () => {
  let db: TestDb;
  let sql: Sql;
  let usuario: string;

  const puede = async (rol: string, fn: string) => {
    const [r] = await sql`SELECT has_function_privilege(${rol}, ${fn}, 'EXECUTE') AS ok`;
    return r.ok as boolean;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    usuario = await createUser(sql, 'usuario@ejemplo.test');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('anon y authenticated no pueden ejecutar las funciones de la cola; service_role sí', async () => {
    for (const fn of FUNCIONES) {
      expect(await puede('anon', fn), `anon · ${fn}`).toBe(false);
      expect(await puede('authenticated', fn), `authenticated · ${fn}`).toBe(false);
      expect(await puede('service_role', fn), `service_role · ${fn}`).toBe(true);
    }
    await expect(
      asAnon(sql, (tx) => tx`SELECT public.enqueue_email('transactional_emails', '{}'::jsonb)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, usuario, (tx) => tx`SELECT * FROM public.read_email_batch('transactional_emails', 10, 30)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('también las funciones que crea la herramienta de correo de Lovable fuera de las migraciones', async () => {
    // Las simula como las crea Lovable: SECURITY DEFINER y con los privilegios por defecto.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.email_queue_dispatch() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN END $f$;
      CREATE OR REPLACE FUNCTION public.email_queue_wake() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN NEW; END $f$;`);
    expect(await puede('anon', 'public.email_queue_dispatch()')).toBe(true);

    // La migración es idempotente: se vuelve a aplicar sobre una base que ya la tiene.
    await sql.unsafe(readFileSync(MIGRACION, 'utf8').replace(/\r\n/g, '\n'));
    for (const fn of ['public.email_queue_dispatch()', 'public.email_queue_wake()', ...FUNCIONES]) {
      expect(await puede('anon', fn), `anon · ${fn}`).toBe(false);
      expect(await puede('authenticated', fn), `authenticated · ${fn}`).toBe(false);
      expect(await puede('service_role', fn), `service_role · ${fn}`).toBe(true);
    }
  });

  it('el registro admite el estado rate_limited', async () => {
    await sql`
      INSERT INTO email_send_log (message_id, template_name, recipient_email, status)
      VALUES ('m1', 'team-invitation', 'a@ejemplo.test', 'rate_limited')`;
    await expect(
      sql`INSERT INTO email_send_log (message_id, template_name, recipient_email, status)
          VALUES ('m2', 'team-invitation', 'a@ejemplo.test', 'inventado')`,
    ).rejects.toThrow(/email_send_log_status_check/);
  });
});
