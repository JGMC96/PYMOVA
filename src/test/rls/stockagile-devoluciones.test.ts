// @vitest-environment node
// Devoluciones del TPV → Stockagile (0037): cola de movimientos solo para negocios conectados,
// reclamación sin duplicados, los envíos a medias pasan a revisión y nunca se reintentan solos,
// y los fallos se ven y se reintentan solo por administradores.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

interface Mov {
  id: string;
  status: string;
  quantity: number;
  attempts: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · devoluciones del TPV a Stockagile', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otro: string;
  let owner: string;
  let staff: string;
  let numero = 0;

  /** Venta y devolución mínimas, directas en las tablas (como superusuario). */
  const devolver = async (business: string, cantidad: number, restock = true) => {
    numero += 1;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
      VALUES (${business}, ${'Calcetín ' + numero}, 6, 10, true) RETURNING id`;
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, subtotal, tax, total, payment_method)
      VALUES (${business}, ${'VTA-8' + String(numero).padStart(5, '0')}, 4.96, 1.04, 6, 'cash') RETURNING id`;
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO sale_returns (business_id, sale_id, return_number, total, refund_method, restock)
      VALUES (${business}, ${s.id}, ${'DEV-8' + String(numero).padStart(5, '0')}, ${6 * cantidad}, 'cash', ${restock})
      RETURNING id`;
    const [i] = await sql<{ id: string }[]>`
      INSERT INTO sale_return_items (return_id, product_id, product_name, quantity, unit_price, total)
      VALUES (${r.id}, ${p.id}, 'Calcetín', ${cantidad}, 6, ${6 * cantidad}) RETURNING id`;
    return i.id;
  };

  const movimientos = (business: string) =>
    sql<Mov[]>`SELECT id, status, quantity, attempts FROM stockagile_stock_moves WHERE business_id = ${business} ORDER BY created_at`;

  const reclamar = async (business: string) => {
    const filas = await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE service_role');
      return tx<Mov[]>`SELECT id, status, quantity, attempts FROM public.claim_stockagile_moves(${business}, 20)`;
    });
    return filas as Mov[];
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otro = o.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${negocio})`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('cada artículo devuelto con reposición entra una vez en la cola, solo en negocios conectados', async () => {
    const linea = await devolver(negocio, 2);
    await devolver(negocio, 1, false); // sin reposición: no suma
    await devolver(otro, 1); // negocio sin Stockagile
    expect(await movimientos(negocio)).toMatchObject([{ status: 'pending', quantity: 2, attempts: 0 }]);
    expect(await movimientos(otro)).toEqual([]);
    // La misma línea no se encola dos veces.
    await expect(sql`
      INSERT INTO stockagile_stock_moves (business_id, quantity, reason, source_table, source_id)
      VALUES (${negocio}, 2, 'return', 'sale_return_items', ${linea})`).rejects.toMatchObject({ code: '23505' });
  });

  it('solo el servidor reclama, y dos reclamaciones no cogen la misma fila', async () => {
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM public.claim_stockagile_moves(${negocio}, 20)`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    const [r] = await sql`SELECT public.stockagile_pending_work() AS hay`;
    expect(r.hay).toBe(true);

    const primera = await reclamar(negocio);
    expect(primera).toMatchObject([{ status: 'sending', attempts: 1 }]);
    expect(await reclamar(negocio)).toEqual([]);
  });

  it('un envío a medias pasa a revisión y no se vuelve a enviar solo', async () => {
    await sql`UPDATE stockagile_stock_moves SET claimed_at = now() - interval '11 minutes' WHERE business_id = ${negocio} AND status = 'sending'`;
    const [r] = await sql`SELECT public.stockagile_pending_work() AS hay`;
    expect(r.hay).toBe(true);
    expect(await reclamar(negocio)).toEqual([]);
    const [m] = await movimientos(negocio);
    expect(m.status).toBe('review');
    const [r2] = await sql`SELECT public.stockagile_pending_work() AS hay`;
    expect(r2.hay).toBe(false);
  });

  it('los fallos y las revisiones se ven en el panel; reintentar solo devuelve los fallos a la cola', async () => {
    await devolver(negocio, 1);
    await sql`UPDATE stockagile_stock_moves SET status = 'failed', last_error = 'Sin emparejar', attempts = 1 WHERE business_id = ${negocio} AND status = 'pending'`;

    const avisos = await asUser(sql, owner, (tx) => tx<{ kind: string; state: string; reference: string }[]>`
      SELECT kind, state, reference FROM public.get_shopify_problems(${negocio}) WHERE kind = 'stockagile'`);
    expect(avisos).toHaveLength(2);
    expect(avisos.every((a) => a.state === 'failed')).toBe(true);
    expect(avisos.map((a) => a.reference)).toEqual(
      expect.arrayContaining([expect.stringContaining('(+1)'), expect.stringContaining('(+2)')]),
    );

    await expect(asUser(sql, staff, (tx) => tx`SELECT * FROM public.retry_shopify_problems(${negocio})`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    await asUser(sql, owner, (tx) => tx`SELECT * FROM public.retry_shopify_problems(${negocio})`);
    const estados = (await movimientos(negocio)).map((m) => m.status);
    expect(estados).toEqual(['review', 'pending']);
  });

  it('el personal y anon no leen la cola ni la conexión; el administrador sí', async () => {
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM stockagile_stock_moves`)).toEqual([]);
    expect(await asUser(sql, staff, (tx) => tx`SELECT business_id FROM stockagile_connections`)).toEqual([]);
    expect((await asUser(sql, owner, (tx) => tx`SELECT id FROM stockagile_stock_moves`)).length).toBe(2);
    await expect(asAnon(sql, (tx) => tx`SELECT id FROM stockagile_stock_moves`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`
      INSERT INTO stockagile_stock_moves (business_id, quantity, reason, source_table, source_id)
      VALUES (${negocio}, 1, 'return', 'x', gen_random_uuid())`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });
});
