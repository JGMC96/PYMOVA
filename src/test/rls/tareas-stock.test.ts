// @vitest-environment node
// Tareas programadas de stock: shopify_pending_work dice si hay avisos de Shopify
// o envíos de stock pendientes, para que la tarea frecuente no llame a nada en vano.
// La migración se aplica aunque no exista pg_cron (como en esta base de tests).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

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
});
