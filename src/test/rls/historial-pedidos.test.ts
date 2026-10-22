// @vitest-environment node
// Historial de pedidos (0045): upsert_external_order guarda la fecha real del pedido (al crear y
// al actualizar), sigue funcionando sin ella y solo lo usa el servidor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · historial de pedidos de Shopify', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;

  const upsert = (externalId: string, placedAt: string | null, items: unknown[] = []) =>
    placedAt === null
      ? sql<{ order_id: string; was_created: boolean }[]>`
          SELECT * FROM public.upsert_external_order(
            ${negocio}, 'shopify', ${externalId}, '#' || ${externalId}, 'Ana', 'ana@ejemplo.test', null, null,
            'shipped', 'paid', 'shopify', 100, 0, 17.36, 0, 100, null, null, ${sql.json(items as never)}::jsonb, now())`
      : sql<{ order_id: string; was_created: boolean }[]>`
          SELECT * FROM public.upsert_external_order(
            _business_id => ${negocio}, _source => 'shopify', _external_id => ${externalId}, _order_number => '#' || ${externalId},
            _customer_name => 'Ana', _customer_email => 'ana@ejemplo.test', _customer_phone => null, _shipping_address => null,
            _status => 'shipped', _payment_status => 'paid', _payment_method => 'shopify', _subtotal => 100, _shipping_cost => 0,
            _tax => 17.36, _discount => 0, _total => 100, _tracking_number => null, _notes => null,
            _items => ${sql.json(items as never)}::jsonb, _external_updated_at => now(), _placed_at => ${placedAt}::timestamptz)`;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO clients (business_id, name, email) VALUES (${negocio}, 'Ana', 'ana@ejemplo.test')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('crea con la fecha real del pedido', async () => {
    const [r] = await upsert('A1', '2024-03-05T10:00:00Z', [{ product_name: 'Zueco Rio - 38', quantity: 1, total: 100 }]);
    expect(r.was_created).toBe(true);
    const [o] = await sql<{ created_at: Date; client_id: string | null }[]>`SELECT created_at, client_id FROM online_orders WHERE id = ${r.order_id}`;
    expect(o.created_at.toISOString()).toBe('2024-03-05T10:00:00.000Z');
    expect(o.client_id).not.toBeNull();
  });

  it('corrige la fecha de un pedido importado antes y no cambia sin ella', async () => {
    const [r] = await upsert('A2', null);
    const [antes] = await sql<{ created_at: Date }[]>`SELECT created_at FROM online_orders WHERE id = ${r.order_id}`;
    expect(Date.now() - antes.created_at.getTime()).toBeLessThan(60_000);
    const [r2] = await upsert('A2', '2023-11-20T09:30:00Z');
    expect(r2).toMatchObject({ order_id: r.order_id, was_created: false });
    const [despues] = await sql<{ created_at: Date }[]>`SELECT created_at FROM online_orders WHERE id = ${r.order_id}`;
    expect(despues.created_at.toISOString()).toBe('2023-11-20T09:30:00.000Z');
    await upsert('A2', null);
    const [igual] = await sql<{ created_at: Date }[]>`SELECT created_at FROM online_orders WHERE id = ${r.order_id}`;
    expect(igual.created_at.toISOString()).toBe('2023-11-20T09:30:00.000Z');
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM online_orders WHERE external_id = 'A2'`;
    expect(n.n).toBe(1);
  });

  it('solo una versión de la función y solo para el servidor', async () => {
    const [f] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'upsert_external_order'`;
    expect(f.n).toBe(1);
    await expect(asUser(sql, owner, (tx) => tx`
      SELECT * FROM public.upsert_external_order(${negocio}, 'shopify', 'X', '#X', 'A', null, null, null,
        'shipped', 'paid', 'shopify', 1, 0, 0, 0, 1, null, null, '[]'::jsonb, now())`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });
});
