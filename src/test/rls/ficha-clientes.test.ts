// @vitest-environment node
// Ficha de clienta (0044): pedidos online unidos por correo, lista paginada con gasto neto y
// ficha con compras de tienda y web, talla habitual y modelos. Solo miembros del negocio.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · ficha de clienta', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let ajeno: string;
  let ana: string;
  let bea: string;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;

    // Pedido web que llega ANTES que la clienta (se une al crearla).
    const [o0] = await sql<{ id: string }[]>`
      INSERT INTO online_orders (business_id, order_number, customer_name, customer_email, status, payment_status, total, created_at)
      VALUES (${negocio}, '#1001', 'Ana', 'ANA@ejemplo.test', 'shipped', 'paid', 100, '2026-09-01') RETURNING id`;
    await sql`INSERT INTO online_order_items (order_id, product_name, quantity, total) VALUES (${o0.id}, 'Zueco Rio Tira Pelo Cow - 38', 1, 100)`;

    const [c1] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name, email) VALUES (${negocio}, 'Ana Pérez', 'ana@ejemplo.test') RETURNING id`;
    ana = c1.id;
    const [c2] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name, email, phone) VALUES (${negocio}, 'Beatriz Núñez', 'bea@ejemplo.test', '600 111 222') RETURNING id`;
    bea = c2.id;

    // Pedido web que llega DESPUÉS (se une al entrar) y uno devuelto.
    const [o1] = await sql<{ id: string }[]>`
      INSERT INTO online_orders (business_id, order_number, customer_name, customer_email, status, payment_status, total, created_at)
      VALUES (${negocio}, '#1002', 'Ana', 'ana@ejemplo.test', 'shipped', 'paid', 120, '2026-10-01') RETURNING id`;
    await sql`INSERT INTO online_order_items (order_id, product_name, quantity, total) VALUES (${o1.id}, 'Botín Denia Elástico - 38', 1, 120)`;
    await sql`
      INSERT INTO online_orders (business_id, order_number, customer_name, customer_email, status, payment_status, total, created_at)
      VALUES (${negocio}, '#1003', 'Ana', 'ana@ejemplo.test', 'returned', 'refunded', 90, '2026-10-05')`;

    // Venta de tienda con devolución parcial.
    const [s1] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, client_id, total, payment_method, created_at)
      VALUES (${negocio}, 'VTA-000001', ${ana}, 155, 'card', '2026-10-20') RETURNING id`;
    await sql`INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, total) VALUES
      (${s1.id}, 'Zueco Bolonia Piel Negro - 39', 1, 149, 149), (${s1.id}, 'Calcetines', 1, 6, 6)`;
    await sql`INSERT INTO sale_returns (business_id, sale_id, return_number, total) VALUES (${negocio}, ${s1.id}, 'DEV-000001', 6)`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('une los pedidos web por correo, lleguen antes o después de la clienta', async () => {
    const rows = await sql<{ order_number: string; client_id: string | null }[]>`
      SELECT order_number, client_id FROM online_orders WHERE business_id = ${negocio} ORDER BY order_number`;
    expect(rows.map((r) => r.client_id)).toEqual([ana, ana, ana]);
    // Si se cambia el correo a uno con pedidos sueltos, se unen.
    await sql`
      INSERT INTO online_orders (business_id, order_number, customer_name, customer_email, status, payment_status, total)
      VALUES (${negocio}, '#1004', 'B', 'nueva@ejemplo.test', 'shipped', 'paid', 50)`;
    await sql`UPDATE clients SET email = 'nueva@ejemplo.test' WHERE id = ${bea}`;
    const [b] = await sql<{ client_id: string }[]>`SELECT client_id FROM online_orders WHERE order_number = '#1004'`;
    expect(b.client_id).toBe(bea);
  });

  it('lista con gasto neto, búsqueda sin tildes y orden por gasto', async () => {
    const lista = await asUser(sql, owner, (tx) => tx<{ name: string; purchases: string; spent: string; total_count: string }[]>`
      SELECT * FROM public.list_clients_with_stats(${negocio}, null, false, 'spent', 50, 0)`);
    expect(lista.map((r) => [r.name, Number(r.purchases), Number(r.spent), Number(r.total_count)])).toEqual([
      ['Ana Pérez', 3, 369, 2], // 100 + 120 + (155 − 6); el devuelto no suma
      ['Beatriz Núñez', 1, 50, 2],
    ]);
    const busca = await asUser(sql, owner, (tx) => tx<{ name: string }[]>`
      SELECT name FROM public.list_clients_with_stats(${negocio}, 'nunez', false, 'name', 50, 0)`);
    expect(busca.map((r) => r.name)).toEqual(['Beatriz Núñez']);
    const tel = await asUser(sql, owner, (tx) => tx<{ name: string }[]>`
      SELECT name FROM public.list_clients_with_stats(${negocio}, '600111', false, 'name', 50, 0)`);
    expect(tel.map((r) => r.name)).toEqual(['Beatriz Núñez']);
    const pag = await asUser(sql, owner, (tx) => tx<{ name: string }[]>`
      SELECT name FROM public.list_clients_with_stats(${negocio}, null, false, 'name', 1, 1)`);
    expect(pag.map((r) => r.name)).toEqual(['Beatriz Núñez']);
  });

  it('ficha con tienda y web, talla habitual y modelos', async () => {
    const [r] = await asUser(sql, owner, (tx) => tx<{ h: Record<string, unknown> }[]>`
      SELECT public.get_client_history(${negocio}, ${ana}) AS h`);
    const h = r.h as {
      summary: Record<string, number | string>;
      sizes: { size: string; units: number }[];
      models: { name: string }[];
      purchases: { channel: string; number: string; net: number; status: string; items: unknown[] }[];
    };
    expect(h.summary).toMatchObject({ purchases: 3, spent: 369, store_purchases: 1, online_purchases: 2, returned: 2 });
    expect(h.sizes[0]).toEqual({ size: '38', units: 2 });
    expect(h.models.map((m) => m.name)).toContain('Zueco Bolonia Piel Negro');
    expect(h.purchases.map((p) => [p.channel, p.number, Number(p.net), p.status])).toEqual([
      ['store', 'VTA-000001', 149, 'returned'],
      ['online', '#1003', 0, 'returned'],
      ['online', '#1002', 120, 'shipped'],
      ['online', '#1001', 100, 'shipped'],
    ]);
    expect(h.purchases[0].items).toHaveLength(2);
  });

  it('solo miembros del negocio', async () => {
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.list_clients_with_stats(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT public.get_client_history(${negocio}, ${ana})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.list_clients_with_stats(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM public.client_purchases(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });
});
