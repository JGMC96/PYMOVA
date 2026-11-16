// @vitest-environment node
// 0062: los vales de Stockagile en la copia de sus tickets. Solo columnas nuevas: se leen como el
// resto de la copia (miembros del negocio), nadie de fuera las ve y la cuenta del usuario no
// puede escribirlas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };

interface LineaVale {
  product_name: string;
  total: string;
  is_gift_card: boolean;
  gift_card_code: string | null;
  gift_card_charged_id: string | null;
  gift_card_consumed_id: string | null;
}

describe.skipIf(!RLS_DB_URL)('RLS · vales de Stockagile en la copia', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let negocio: string;
  let devolucion: string;
  let venta: string;

  const ticket = async (externalId: number, total: number, isReturn: boolean) => {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return)
      VALUES (${negocio}, ${externalId}, ${'VT' + externalId}, now(), ${total}, ${isReturn}) RETURNING id`;
    return s.id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    await asUser(sql, ajeno, (tx) => tx`SELECT public.create_business('Otra', null)`);

    // Vale emitido al devolver (carga la tarjeta 77) y gastado en parte en una venta.
    devolucion = await ticket(1, 0, true);
    await sql`
      INSERT INTO stockagile_sale_items (sale_id, product_name, quantity, total, is_gift_card, gift_card_code, gift_card_charged_id)
      VALUES (${devolucion}, 'Vale', 1, 149, true, 'TG-00123', 77)`;
    venta = await ticket(2, 30, false);
    await sql`
      INSERT INTO stockagile_sale_items (sale_id, product_name, quantity, total, is_gift_card, gift_card_code, gift_card_consumed_id)
      VALUES (${venta}, 'Vale', 1, -100, true, 'TG-00123', 77)`;
    await sql`INSERT INTO stockagile_sale_items (sale_id, product_name, quantity, total) VALUES (${venta}, 'Zueco - 39', 1, 130)`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('la migración se puede aplicar otra vez sin perder nada', async () => {
    await sql.unsafe(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0062_0062_vales_stockagile_copia.sql'), 'utf8'));
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stockagile_sale_items WHERE gift_card_code = 'TG-00123'`;
    expect(n.n).toBe(2);
  });

  it('las líneas de siempre quedan como «no es un vale»', async () => {
    const [l] = await sql<{ is_gift_card: boolean; gift_card_code: string | null }[]>`
      SELECT is_gift_card, gift_card_code FROM stockagile_sale_items WHERE product_name = 'Zueco - 39'`;
    expect(l).toEqual({ is_gift_card: false, gift_card_code: null });
  });

  it('con la copia se sabe lo que le queda a un vale: cargas menos gastos', async () => {
    const [r] = await sql<{ saldo: string }[]>`
      SELECT sum(total) AS saldo FROM stockagile_sale_items
      WHERE gift_card_charged_id = 77 OR gift_card_consumed_id = 77`;
    expect(Number(r.saldo)).toBe(49);
  });

  it('los miembros del negocio leen los vales, como el resto de la copia', async () => {
    for (const quien of [owner, staff]) {
      const filas = await asUser(sql, quien, (tx) => tx<LineaVale[]>`
        SELECT product_name, total, is_gift_card, gift_card_code, gift_card_charged_id, gift_card_consumed_id
        FROM stockagile_sale_items WHERE is_gift_card ORDER BY total DESC`);
      expect(filas.map((f) => [f.gift_card_code, Number(f.total), f.gift_card_charged_id, f.gift_card_consumed_id])).toEqual([
        ['TG-00123', 149, '77', null],
        ['TG-00123', -100, null, '77'],
      ]);
    }
  });

  it('nadie de fuera los ve', async () => {
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT gift_card_code FROM stockagile_sale_items`)).resolves.toHaveLength(0);
    await expect(asAnon(sql, (tx) => tx`SELECT gift_card_code FROM stockagile_sale_items`)).rejects.toMatchObject(DENEGADO);
  });

  it('la cuenta del usuario no puede escribir en la copia', async () => {
    await expect(asUser(sql, owner, (tx) => tx`
      UPDATE stockagile_sale_items SET gift_card_code = 'OTRO' WHERE sale_id = ${venta}`)).rejects.toMatchObject(DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`
      INSERT INTO stockagile_sale_items (sale_id, product_name, total, is_gift_card, gift_card_charged_id)
      VALUES (${venta}, 'Vale', 500, true, 99)`)).rejects.toMatchObject(DENEGADO);
  });
});
