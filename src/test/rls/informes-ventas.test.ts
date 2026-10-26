// @vitest-environment node
// Informe de ventas (0055): solo el propietario; suma las ventas de PYMOVA y los tickets de
// Stockagile, con las devoluciones en negativo, sin tickets borrados, por día del negocio y con
// la comparación del año anterior. Solo lectura.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

interface Fila {
  m?: string;
  seller_key?: string;
  name?: string;
  cur_count: number;
  cur_sales: number;
  cur_net: number;
  prev_count: number;
  prev_net: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · informe de ventas (0055)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let ajeno: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let otroOwner: string;
  let ana: string;

  const informe = (user: string, desde = '2026-10-01', hasta = '2026-10-31', business = negocio) =>
    asUser(sql, user, async (tx) => {
      const [r] = await tx<{ r: any }[]>`SELECT public.get_sales_report(${business}, ${desde}::date, ${hasta}::date) AS r`;
      return r.r;
    });

  const venta = (n: number, total: number, pago: string, creada: string, extra: { vendedor?: string; vale?: number } = {}) =>
    sql`INSERT INTO sales (business_id, sale_number, total, payment_method, created_at, seller_employee_id, voucher_amount)
        VALUES (${negocio}, ${'VTA-' + String(n).padStart(6, '0')}, ${total}, ${pago}, ${creada},
                ${extra.vendedor ?? null}, ${extra.vale ?? 0})
        RETURNING id`;

  const ticket = (id: number, total: number, pago: string | null, vendido: string, opts: { devolucion?: boolean; borrado?: boolean } = {}) =>
    sql`INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, deleted, payment_methods)
        VALUES (${negocio}, ${id}, ${'VT' + id}, ${vendido}, ${total}, ${opts.devolucion ?? false}, ${opts.borrado ?? false}, ${pago})`;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    otroOwner = await createUser(sql, 'otro@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, otroOwner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Ajena', null) AS id`);
    ajeno = o.id;
    await sql`UPDATE businesses SET timezone = 'Europe/Madrid' WHERE id = ${negocio}`;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${admin}, 'admin', true)`;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    const [e] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    ana = e.id;

    // PYMOVA, octubre de 2026.
    await venta(1, 100, 'card', '2026-10-10T10:00:00Z', { vendedor: ana });
    await venta(2, 50, 'cash', '2026-10-10T11:00:00Z', { vale: 20 }); // 30 en efectivo y 20 con vale
    await venta(3, 10, 'card', '2026-09-30T22:30:00Z'); // 00:30 del 1 de octubre en Madrid: entra
    await venta(4, 999, 'card', '2026-10-31T23:30:00Z'); // 00:30 del 1 de noviembre en Madrid: no entra
    const [v1] = await sql<{ id: string }[]>`SELECT id FROM sales WHERE business_id = ${negocio} AND sale_number = 'VTA-000001'`;
    await sql`INSERT INTO sale_returns (business_id, sale_id, return_number, total, refund_method, seller_employee_id, created_at)
              VALUES (${negocio}, ${v1.id}, 'DEV-000001', 30, 'cash', ${ana}, '2026-10-12T10:00:00Z')`;

    // Stockagile, octubre de 2026 y octubre de 2025.
    await ticket(1, 80, 'Tarjeta', '2026-10-10T09:00:00Z');
    await ticket(2, 40, 'Metálico · Tarjeta', '2026-10-11T09:00:00Z');
    await ticket(3, -25, 'Metálico', '2026-10-12T09:00:00Z', { devolucion: true });
    await ticket(4, 15, 'Tarjeta', '2026-10-13T09:00:00Z', { devolucion: true }); // cambio con diferencia a favor
    await ticket(5, 500, 'Tarjeta', '2026-10-13T09:00:00Z', { borrado: true });
    await ticket(6, 5, null, '2026-10-14T09:00:00Z');
    await ticket(7, 200, 'Tarjeta', '2025-10-10T09:00:00Z');

    // Otro negocio: no debe colarse.
    await sql`INSERT INTO sales (business_id, sale_number, total, payment_method, created_at)
              VALUES (${ajeno}, 'VTA-000001', 7777, 'card', '2026-10-10T10:00:00Z')`;
    await sql`INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, payment_methods)
              VALUES (${ajeno}, 1, 'VT1', '2026-10-10T10:00:00Z', 8888, 'Tarjeta')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('solo el propietario del negocio lo ve: administrador, personal, propietario ajeno y anónimo, no', async () => {
    const r = await informe(owner);
    expect(r.current.sales_count).toBeGreaterThan(0);
    await expect(informe(admin)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(informe(staff)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(informe(otroOwner)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asAnon(sql, (tx) => tx`SELECT public.get_sales_report(${negocio}, '2026-10-01'::date, '2026-10-31'::date)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('suma PYMOVA y Stockagile con devoluciones, cambios y borrados, por el día del negocio', async () => {
    const r = await informe(owner);
    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.previous).toEqual({ from: '2025-10-01', to: '2025-10-31' });
    // Ventas: 100 + 50 + 10 (PYMOVA) y 80 + 40 + 5 (Stockagile). No cuentan la venta del 1 de
    // noviembre en Madrid, el ticket borrado ni los datos de otro negocio.
    expect(r.current).toMatchObject({
      sales_count: 6,
      sales_total: 285,
      returns_count: 2,
      returns_total: 55,
      exchanges_count: 1,
      exchanges_total: 15,
      net_total: 245,
    });
    expect(r.prior).toMatchObject({ sales_count: 1, sales_total: 200, net_total: 200 });

    const origen = (src: string, per: string) =>
      r.by_source.find((x: { src: string; per: string }) => x.src === src && x.per === per);
    expect(origen('pymova', 'cur')).toMatchObject({ sales_count: 3, sales_total: 160, net_total: 130 });
    expect(origen('stockagile', 'cur')).toMatchObject({ sales_count: 3, sales_total: 125, net_total: 115 });
    expect(origen('stockagile', 'prev')).toMatchObject({ sales_count: 1, net_total: 200 });
  });

  it('desglosa por forma de pago (vale aparte, Stockagile sin desglose) y por vendedor', async () => {
    const r = await informe(owner);
    const pago = (m: string): Fila => r.by_payment.find((x: Fila) => x.m === m);
    expect(pago('card')).toMatchObject({ cur_count: 3, cur_sales: 190, cur_net: 205, prev_count: 1, prev_net: 200 });
    expect(pago('cash')).toMatchObject({ cur_count: 1, cur_sales: 30, cur_net: -25 });
    expect(pago('store_credit')).toMatchObject({ cur_count: 1, cur_sales: 20, cur_net: 20 });
    expect(pago('cash_card')).toMatchObject({ cur_count: 1, cur_sales: 40 });
    expect(pago('none')).toMatchObject({ cur_count: 1, cur_sales: 5 });
    const total = r.by_payment.reduce((s: number, x: Fila) => s + x.cur_net, 0);
    expect(total).toBe(245);

    const vendedor = (k: string): Fila => r.by_seller.find((x: Fila) => x.seller_key === k);
    expect(vendedor(ana)).toMatchObject({ name: 'Ana', cur_count: 1, cur_sales: 100, cur_net: 70 });
    expect(vendedor('none')).toMatchObject({ name: 'Sin vendedor', cur_count: 2, cur_net: 60 });
    expect(vendedor('stockagile')).toMatchObject({ cur_count: 3, cur_sales: 125, cur_net: 115 });
  });

  it('da una fila por día con el mismo día del año anterior', async () => {
    const r = await informe(owner);
    expect(r.by_day).toHaveLength(31);
    const dia = (d: string) => r.by_day.find((x: { date: string }) => x.date === d);
    expect(dia('2026-10-01')).toMatchObject({ cur_count: 1, cur_net: 10 });
    expect(dia('2026-10-10')).toMatchObject({ cur_count: 3, cur_net: 230, prev_count: 1, prev_net: 200 });
    expect(dia('2026-10-11')).toMatchObject({ cur_count: 1, cur_net: 40, prev_count: 0, prev_net: 0 });
  });

  it('un periodo sin ventas da ceros, y un periodo no válido se rechaza', async () => {
    const vacio = await informe(owner, '2024-01-01', '2024-01-31');
    expect(vacio.current).toMatchObject({ sales_count: 0, net_total: 0 });
    expect(vacio.by_payment).toEqual([]);
    await expect(informe(owner, '2026-10-31', '2026-10-01')).rejects.toMatchObject({ code: '22023' });
    await expect(informe(owner, '2024-01-01', '2026-10-01')).rejects.toMatchObject({ code: '22023' });
  });

  it('rinde con el volumen de una tienda real (5.000 tickets de Stockagile y 2.000 ventas)', async () => {
    const [g] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Grande', null) AS id`);
    await sql`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, payment_methods)
      SELECT ${g.id}, i, 'VT' || i, timestamptz '2022-06-01' + (i * interval '8 hours'), CASE WHEN i % 10 = 0 THEN -40 ELSE 60 END,
             i % 10 = 0, CASE WHEN i % 3 = 0 THEN 'Metálico' ELSE 'Tarjeta' END
      FROM generate_series(1, 5000) i`;
    await sql`
      INSERT INTO sales (business_id, sale_number, total, payment_method, created_at)
      SELECT ${g.id}, 'VTA-' || lpad(i::text, 6, '0'), 55, 'card', timestamptz '2026-01-01' + (i * interval '3 hours')
      FROM generate_series(1, 2000) i`;
    await sql`ANALYZE stockagile_sales`;
    await sql`ANALYZE sales`;
    const t0 = performance.now();
    const r = await informe(owner, '2026-01-01', '2026-12-31', g.id);
    const ms = performance.now() - t0;
    console.log(`get_sales_report (año completo, 5.000 tickets + 2.000 ventas): ${ms.toFixed(0)} ms`);
    expect(r.current.sales_count).toBeGreaterThan(1000);
    expect(r.prior.sales_count).toBeGreaterThan(0);
    expect(r.by_day).toHaveLength(365);
    expect(ms).toBeLessThan(3000);
  });

  it('el propietario ajeno solo ve lo suyo y la consulta no cambia nada', async () => {
    const antes = await sql`SELECT (SELECT count(*) FROM sales) AS v, (SELECT count(*) FROM stock_movements) AS m,
                                   (SELECT count(*) FROM cash_register_sessions) AS c`;
    const r = await informe(otroOwner, '2026-10-01', '2026-10-31', ajeno);
    expect(r.current).toMatchObject({ sales_count: 2, sales_total: 16665, net_total: 16665 });
    const despues = await sql`SELECT (SELECT count(*) FROM sales) AS v, (SELECT count(*) FROM stock_movements) AS m,
                                     (SELECT count(*) FROM cash_register_sessions) AS c`;
    expect(despues).toEqual(antes);
  });
});
