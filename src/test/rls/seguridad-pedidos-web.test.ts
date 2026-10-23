// @vitest-environment node
// Revisión de seguridad (0048): los pedidos web solo se crean y se cambian por RPC, y sin
// sesión no se ejecuta ninguna función privilegiada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const LINEAS = [{ product_name: 'Calcetines', quantity: 1, unit_price: 6, total: 6 }];

describe.skipIf(!RLS_DB_URL)('RLS · pedidos web solo por RPC (0048)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;
  let pedido: string;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el personal crea y cambia pedidos con las RPC', async () => {
    const [r] = await asUser(sql, staff, (tx) => tx<{ order_id: string }[]>`
      SELECT * FROM public.create_online_order(_business_id => ${negocio}, _items => ${tx.json(LINEAS)}, _customer_name => 'Ana')`);
    pedido = r.order_id;
    await asUser(sql, staff, (tx) => tx`SELECT public.set_online_order_status(${pedido}, 'shipped', 'ABC123')`);
    const [o] = await sql<{ status: string; total: string }[]>`SELECT status, total FROM online_orders WHERE id = ${pedido}`;
    expect(o.status).toBe('shipped');
    expect(Number(o.total)).toBe(6);
  });

  it('nadie escribe directamente en pedidos, líneas ni devoluciones web', async () => {
    for (const user of [staff, owner]) {
      await expect(asUser(sql, user, (tx) => tx`
        INSERT INTO online_orders (business_id, order_number, customer_name, subtotal, total)
        VALUES (${negocio}, 'WEB-X', 'X', 1, 1)`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`UPDATE online_orders SET stock_applied = false WHERE id = ${pedido}`))
        .rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`UPDATE online_order_items SET total = 0`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM online_orders WHERE id = ${pedido}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM online_order_returns`)).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    // Pero lo siguen viendo.
    const vistos = await asUser(sql, staff, (tx) => tx`SELECT id FROM online_orders WHERE id = ${pedido}`);
    expect(vistos).toHaveLength(1);
  });

  it('sin sesión no se ejecutan las RPC de pedidos ni las funciones de trigger', async () => {
    await expect(asAnon(sql, (tx) => tx`
      SELECT * FROM public.create_online_order(_business_id => ${negocio}, _items => ${tx.json(LINEAS)}, _customer_name => 'X')`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT public.owned_business_count(${owner})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    const abiertas = await sql<{ proname: string }[]>`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')`;
    expect(abiertas.map((f) => f.proname)).toEqual([]);
  });

  it('los triggers de protección tienen search_path fijo', async () => {
    const sinRuta = await sql<{ proname: string }[]>`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'protect\\_%'
        AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`;
    expect(sinRuta).toEqual([]);
  });
});
