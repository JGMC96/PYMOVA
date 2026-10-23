// @vitest-environment node
// Ventas de Stockagile (0046): copia de solo lectura de los tickets de tienda, unida a la clienta
// por el correo y sumada en su ficha con las devoluciones en negativo. No mueve stock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · ventas de Stockagile', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let ajeno: string;
  let ana: string;
  let variante: string;
  let stockAntes: number;
  let movimientosAntes: number;

  const ticket = async (externalId: number, total: number, opts: { email?: string | null; isReturn?: boolean; deleted?: boolean; soldAt?: string } = {}) => {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, deleted, customer_email, payment_methods)
      VALUES (${negocio}, ${externalId}, ${'VT' + externalId}, ${opts.soldAt ?? '2026-10-20T10:00:00Z'}, ${total},
              ${opts.isReturn ?? false}, ${opts.deleted ?? false}, ${opts.email ?? null}, 'Tarjeta')
      RETURNING id`;
    return s.id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [p] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Zueco Bolonia Piel Negro', 149) RETURNING id`;
    const [v] = await sql<{ id: string; stock_quantity: number }[]>`
      INSERT INTO product_variants (business_id, product_id, name, attributes, barcode, stock_quantity)
      VALUES (${negocio}, ${p.id}, '39', '{"Talla":"39"}', '9600000000017', 5) RETURNING id, stock_quantity`;
    variante = v.id;
    stockAntes = v.stock_quantity;
    const [m] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_movements WHERE business_id = ${negocio}`;
    movimientosAntes = m.n;

    // Ticket que llega antes que la clienta, venta, devolución y uno borrado.
    const s1 = await ticket(1, 149, { email: 'ANA@ejemplo.test' });
    await sql`INSERT INTO stockagile_sale_items (sale_id, product_name, size, barcode, quantity, unit_price, total, variant_id)
              VALUES (${s1}, 'Zueco Bolonia Piel Negro - 39', '39', '9600000000017', 1, 149, 149, ${variante})`;
    const [c] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name, email) VALUES (${negocio}, 'Ana', 'ana@ejemplo.test') RETURNING id`;
    ana = c.id;
    const s2 = await ticket(2, 60, { email: 'ana@ejemplo.test', soldAt: '2026-10-21T10:00:00Z' });
    await sql`INSERT INTO stockagile_sale_items (sale_id, product_name, size, quantity, unit_price, total)
              VALUES (${s2}, 'Calcetines - 35-38', '35-38', 10, 6, 60)`;
    await ticket(3, -6, { email: 'ana@ejemplo.test', isReturn: true, soldAt: '2026-10-22T10:00:00Z' });
    await ticket(4, 500, { email: 'ana@ejemplo.test', deleted: true });
    await ticket(5, 30); // sin clienta
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('une los tickets a la clienta por el correo y no toca el stock', async () => {
    const rows = await sql<{ external_id: string; client_id: string | null }[]>`
      SELECT external_id, client_id FROM stockagile_sales WHERE business_id = ${negocio} ORDER BY external_id`;
    expect(rows.map((r) => r.client_id)).toEqual([ana, ana, ana, ana, null]);
    const [v] = await sql<{ stock_quantity: number }[]>`SELECT stock_quantity FROM product_variants WHERE id = ${variante}`;
    expect(v.stock_quantity).toBe(stockAntes);
    const [mov] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_movements WHERE business_id = ${negocio}`;
    expect(mov.n).toBe(movimientosAntes);
  });

  it('la ficha suma la tienda de Stockagile con las devoluciones en negativo', async () => {
    const [l] = await asUser(sql, owner, (tx) => tx<{ purchases: string; spent: string }[]>`
      SELECT purchases, spent FROM public.list_clients_with_stats(${negocio}, 'ana', false, 'name', 50, 0)`);
    expect([Number(l.purchases), Number(l.spent)]).toEqual([2, 203]); // 149 + 60 − 6; el borrado no cuenta
    const [r] = await asUser(sql, owner, (tx) => tx<{ h: Record<string, unknown> }[]>`SELECT public.get_client_history(${negocio}, ${ana}) AS h`);
    const h = r.h as { summary: Record<string, number>; sizes: { size: string }[]; purchases: { channel: string; number: string; status: string }[] };
    expect(h.summary).toMatchObject({ purchases: 2, spent: 203, store_purchases: 2, returned: 1 });
    expect(h.sizes.map((s) => s.size)).toContain('39');
    expect(h.purchases.map((p) => [p.channel, p.number, p.status])).toEqual([
      ['stockagile', 'VT3', 'returned'],
      ['stockagile', 'VT2', 'done'],
      ['stockagile', 'VT1', 'done'],
    ]);
  });

  it('la tarea trae las ventas si la última copia tiene más de 4 minutos (0047)', async () => {
    const hay = async () => (await sql<{ hay: boolean }[]>`SELECT public.stockagile_pending_work() AS hay`)[0].hay;
    expect(await hay()).toBe(false); // sin conexión
    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${negocio})`;
    expect(await hay()).toBe(true); // nunca copiadas
    await sql`UPDATE stockagile_connections SET sales_synced_at = now() WHERE business_id = ${negocio}`;
    expect(await hay()).toBe(false);
    await sql`UPDATE stockagile_connections SET sales_synced_at = now() - interval '5 minutes' WHERE business_id = ${negocio}`;
    expect(await hay()).toBe(true);
    await sql`UPDATE stockagile_connections SET enabled = false WHERE business_id = ${negocio}`;
    expect(await hay()).toBe(false);
  });

  it('solo se leen, y solo los miembros', async () => {
    const mias = await asUser(sql, owner, (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM stockagile_sales`);
    expect(mias[0].n).toBe(5);
    const lineas = await asUser(sql, owner, (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM stockagile_sale_items`);
    expect(lineas[0].n).toBe(2);
    const ajenas = await asUser(sql, ajeno, (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM stockagile_sales`);
    expect(ajenas[0].n).toBe(0);
    await expect(asUser(sql, owner, (tx) => tx`
      INSERT INTO stockagile_sales (business_id, external_id, sold_at, total) VALUES (${negocio}, 99, now(), 1)`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`UPDATE stockagile_sales SET total = 0`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`DELETE FROM stockagile_sale_items`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });
});
