// @vitest-environment node
// Tareas programadas de stock: shopify_pending_work dice si hay avisos de Shopify
// o envíos de stock pendientes, para que la tarea frecuente no llame a nada en vano.
// Las tareas llaman sin secretos, con un ticket de un solo uso (scheduled_job_tickets).
// La migración se aplica aunque no exista pg_cron (como en esta base de tests).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb, type Tx } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · tareas programadas de stock', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;

  const trabajo = async () => {
    const [r] = await sql`SELECT * FROM public.shopify_pending_work()`;
    return r as { pending_pushes: boolean; pending_events: boolean };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin colas pendientes no hay trabajo', async () => {
    expect(await trabajo()).toEqual({ pending_pushes: false, pending_events: false });
  });

  it('un envío de stock pendiente cuenta; uno agotado de intentos, no', async () => {
    await sql`
      INSERT INTO shopify_inventory_pushes (business_id, delta, reason, status, attempts)
      VALUES (${negocio}, -1, 'sale', 'pending', 5)`;
    expect((await trabajo()).pending_pushes).toBe(false);
    await sql`
      INSERT INTO shopify_inventory_pushes (business_id, delta, reason, status, attempts)
      VALUES (${negocio}, -1, 'sale', 'pending', 0)`;
    expect((await trabajo()).pending_pushes).toBe(true);
  });

  it('un aviso pendiente o vencido cuenta; uno con reintento futuro, todavía no', async () => {
    await sql`
      INSERT INTO integration_webhook_events (business_id, integration_key, topic, event_id, status, next_attempt_at)
      VALUES (${negocio}, 'shopify', 'inventory_levels/update', 'e1', 'retrying', now() + interval '1 hour')`;
    expect((await trabajo()).pending_events).toBe(false);
    await sql`
      INSERT INTO integration_webhook_events (business_id, integration_key, topic, event_id, status)
      VALUES (${negocio}, 'shopify', 'inventory_levels/update', 'e2', 'pending')`;
    expect((await trabajo()).pending_events).toBe(true);
  });

  it('los clientes no pueden consultarla y la conexión tiene las columnas del último refresco', async () => {
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM public.shopify_pending_work()`)).rejects.toMatchObject(
      PERMISO_DENEGADO,
    );
    const [c] = await sql`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'shopify_connections' AND column_name IN ('last_stock_refresh_at', 'last_stock_refresh_status')`;
    expect(c.n).toBe(2);
  });

  const emitir = async (accion: string) => {
    const [r] = await sql<{ id: string }[]>`SELECT public.issue_scheduled_job_ticket(${accion}) AS id`;
    return r.id;
  };
  const gastar = async (ticket: string, accion: string) => {
    // Como la edge function: con el rol service_role.
    const [r] = (await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE service_role');
      return tx<{ ok: boolean }[]>`SELECT public.consume_scheduled_job_ticket(${ticket}, ${accion}) AS ok`;
    })) as { ok: boolean }[];
    return r.ok;
  };

  it('un ticket vale una sola vez y solo para su acción', async () => {
    const t = await emitir('refresh-stock');
    expect(await gastar(t, 'process-webhooks')).toBe(false);
    expect(await gastar(t, 'refresh-stock')).toBe(true);
    expect(await gastar(t, 'refresh-stock')).toBe(false);
    expect(await gastar('00000000-0000-0000-0000-000000000000', 'refresh-stock')).toBe(false);
    await expect(emitir('otra-cosa')).rejects.toThrow(/check/i);
  });

  it('un ticket de más de 10 minutos no vale, y los de más de un día se borran', async () => {
    const viejo = await emitir('push-stock');
    await sql`UPDATE scheduled_job_tickets SET created_at = now() - interval '11 minutes' WHERE id = ${viejo}`;
    expect(await gastar(viejo, 'push-stock')).toBe(false);
    await sql`UPDATE scheduled_job_tickets SET created_at = now() - interval '2 days' WHERE id = ${viejo}`;
    await emitir('push-stock');
    const [r] = await sql`SELECT count(*)::int AS n FROM scheduled_job_tickets WHERE id = ${viejo}`;
    expect(r.n).toBe(0);
  });

  it('ni usuarios ni anónimos crean, gastan ni leen tickets', async () => {
    const t = await emitir('refresh-stock');
    const roles: Array<(fn: (tx: Tx) => Promise<unknown>) => Promise<unknown>> = [
      (fn) => asAnon(sql, fn),
      (fn) => asUser(sql, owner, fn),
    ];
    for (const como of roles) {
      await expect(como((tx) => tx`SELECT public.issue_scheduled_job_ticket('refresh-stock')`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(como((tx) => tx`SELECT public.consume_scheduled_job_ticket(${t}, 'refresh-stock')`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(como((tx) => tx`SELECT id FROM scheduled_job_tickets`)).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    expect(await gastar(t, 'refresh-stock')).toBe(true);
  });
});
