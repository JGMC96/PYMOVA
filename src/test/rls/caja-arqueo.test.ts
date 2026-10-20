// @vitest-environment node
// M2 de docs/AUDITORIA.md: arqueo con devoluciones en efectivo, una sola caja
// abierta, caja solo por RPC, efectivo solo con caja abierta y devoluciones
// por lo cobrado (con descuento).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Negocio {
  id: string;
  owner: string;
  staff: string;
  producto: (precio: number) => Promise<string>;
}

interface Venta {
  producto: string;
  precio: number;
  descuentoPct?: number;
  metodo?: 'cash' | 'card';
  propina?: number;
  caja?: string | null;
}

async function nuevoNegocio(sql: Sql, nombre: string): Promise<Negocio> {
  const owner = await createUser(sql, `owner-${nombre}@ejemplo.test`);
  const staff = await createUser(sql, `staff-${nombre}@ejemplo.test`);
  const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
  await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${b.id}, ${staff}, 'staff', true)`;
  const producto = async (precio: number) => {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
      VALUES (${b.id}, ${'Artículo ' + precio}, ${precio}, 100, true) RETURNING id`;
    return p.id;
  };
  return { id: b.id, owner, staff, producto };
}

function vender(sql: Sql, user: string, negocio: string, v: Venta) {
  const neto = r2(v.precio * (1 - (v.descuentoPct ?? 0) / 100));
  const base = r2(neto / (1 + IVA / 100));
  const items = [{ product_id: v.producto, variant_id: null, product_name: 'Artículo', quantity: 1, unit_price: v.precio, total: neto }];
  return asUser(sql, user, (tx) => tx<{ sale_id: string; sale_number: string }[]>`
    SELECT * FROM public.create_sale_with_items(
      _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb,
      _payment_method => ${v.metodo ?? 'cash'},
      _subtotal => ${base}, _tax => ${r2(neto - base)}, _total => ${neto},
      _discount => ${r2(v.precio - neto)}, _tip => ${v.propina ?? 0},
      _register_session_id => ${v.caja ?? null})`);
}

async function devolver(sql: Sql, user: string, negocio: string, venta: string, metodo: string) {
  const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
  return asUser(sql, user, (tx) => tx<{ return_id: string }[]>`
    SELECT * FROM public.create_sale_return(${negocio}, ${venta}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, 'Talla', ${metodo}, true)`);
}

const abrir = (sql: Sql, user: string, negocio: string, fondo = 100) =>
  asUser(sql, user, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, ${fondo}) AS id`);

describe.skipIf(!RLS_DB_URL)('RLS · caja y arqueo (M2)', () => {
  let db: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('nadie crea ni edita cajas directamente; anon no las ve', async () => {
    const n = await nuevoNegocio(sql, 'directo');
    const [caja] = await abrir(sql, n.owner, n.id);

    await expect(
      asUser(sql, n.staff, (tx) => tx`
        INSERT INTO cash_register_sessions (business_id, status, opening_amount, counted_amount, expected_amount, difference)
        VALUES (${n.id}, 'closed', 0, 1000, 1000, 0)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, n.owner, (tx) => tx`UPDATE cash_register_sessions SET opening_amount = 0 WHERE id = ${caja.id}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM cash_register_sessions`)).rejects.toMatchObject(PERMISO_DENEGADO);

    const visibles = await asUser(sql, n.staff, (tx) => tx`SELECT id FROM cash_register_sessions WHERE business_id = ${n.id}`);
    expect(visibles.length).toBe(1);
  });

  it('dos aperturas a la vez: una abre y la otra recibe un mensaje claro', async () => {
    const n = await nuevoNegocio(sql, 'doble');
    const r = await Promise.allSettled([abrir(sql, n.owner, n.id), abrir(sql, n.staff, n.id)]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const fallo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(fallo.reason.message)).toMatch(/ya hay una caja abierta/i);
    await expect(abrir(sql, n.owner, n.id, -5)).rejects.toThrow(/caja abierta|fondo/i);
  });

  it('arqueo: resta las devoluciones en efectivo, no cuenta la tarjeta y lo cierra el staff', async () => {
    const n = await nuevoNegocio(sql, 'arqueo');
    const [caja] = await abrir(sql, n.owner, n.id, 100);
    const p30 = await n.producto(30);
    const p50 = await n.producto(50);
    const p10 = await n.producto(10);

    await vender(sql, n.staff, n.id, { producto: p30, precio: 30, propina: 2 });
    await vender(sql, n.staff, n.id, { producto: p50, precio: 50, metodo: 'card' });
    const [v10] = await vender(sql, n.staff, n.id, { producto: p10, precio: 10 });
    const [dev] = await devolver(sql, n.staff, n.id, v10.sale_id, 'cash');

    const [d] = await sql`SELECT register_session_id FROM sale_returns WHERE id = ${dev.return_id}`;
    expect(d.register_session_id).toBe(caja.id);

    const resumen = await asUser(sql, n.staff, (tx) => tx`
      SELECT payment_method, sales_count::int, total_amount::float, refunds_count::int, refunds_amount::float
      FROM public.get_register_summary(${caja.id}) ORDER BY payment_method`);
    expect(resumen).toEqual([
      { payment_method: 'card', sales_count: 1, total_amount: 50, refunds_count: 0, refunds_amount: 0 },
      { payment_method: 'cash', sales_count: 2, total_amount: 42, refunds_count: 1, refunds_amount: 10 },
    ]);

    await asUser(sql, n.staff, (tx) => tx`SELECT public.close_register_session(${caja.id}, 130, 'Cierre')`);
    const [c] = await sql`
      SELECT status, expected_amount::float, counted_amount::float, difference::float, closed_by
      FROM cash_register_sessions WHERE id = ${caja.id}`;
    expect(c).toEqual({ status: 'closed', expected_amount: 132, counted_amount: 130, difference: -2, closed_by: n.staff });

    await expect(asUser(sql, n.staff, (tx) => tx`SELECT public.close_register_session(${caja.id}, 130)`)).rejects.toThrow(/cerrada/i);
    const ajeno = await createUser(sql, 'ajeno-arqueo@ejemplo.test');
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT public.close_register_session(${caja.id}, 1)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('efectivo solo con caja abierta; la tarjeta no la necesita y la venta se asocia sola a la caja', async () => {
    const n = await nuevoNegocio(sql, 'sincaja');
    const p = await n.producto(20);

    await expect(vender(sql, n.staff, n.id, { producto: p, precio: 20 })).rejects.toThrow(/abre la caja/i);
    const [conTarjeta] = await vender(sql, n.staff, n.id, { producto: p, precio: 20, metodo: 'card' });
    const [t] = await sql`SELECT register_session_id FROM sales WHERE id = ${conTarjeta.sale_id}`;
    expect(t.register_session_id).toBeNull();
    await expect(devolver(sql, n.staff, n.id, conTarjeta.sale_id, 'cash')).rejects.toThrow(/abre la caja/i);

    const [caja] = await abrir(sql, n.staff, n.id, 0);
    const [enEfectivo] = await vender(sql, n.staff, n.id, { producto: p, precio: 20 });
    const [e] = await sql`SELECT register_session_id FROM sales WHERE id = ${enEfectivo.sale_id}`;
    expect(e.register_session_id).toBe(caja.id);

    const [dev] = await devolver(sql, n.staff, n.id, conTarjeta.sale_id, 'cash');
    const [d] = await sql`SELECT register_session_id FROM sale_returns WHERE id = ${dev.return_id}`;
    expect(d.register_session_id).toBe(caja.id);
  });

  it('una devolución vale lo que se cobró, con el descuento, y el método de reembolso se valida', async () => {
    const n = await nuevoNegocio(sql, 'descuento');
    await abrir(sql, n.owner, n.id, 0);
    const p = await n.producto(99);
    const [v] = await vender(sql, n.staff, n.id, { producto: p, precio: 99, descuentoPct: 10 });

    await expect(devolver(sql, n.staff, n.id, v.sale_id, 'bitcoin')).rejects.toThrow(/método/i);
    const [dev] = await devolver(sql, n.staff, n.id, v.sale_id, 'card');
    const [d] = await sql`SELECT total::float FROM sale_returns WHERE id = ${dev.return_id}`;
    expect(d.total).toBe(89.1);
    const [li] = await sql`SELECT total::float FROM sale_return_items WHERE return_id = ${dev.return_id}`;
    expect(li.total).toBe(89.1);
  });
});

describe.skipIf(!RLS_DB_URL)('RLS · caja: devoluciones anteriores a la migración', () => {
  let db: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    db = await createTestDb({ skip: (f) => f.includes('0021_') });
    sql = db.sql;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('las devoluciones en efectivo hechas con la caja abierta quedan asociadas a ella', async () => {
    const n = await nuevoNegocio(sql, 'previo');
    const p = await n.producto(10);
    const [antes] = await vender(sql, n.owner, n.id, { producto: p, precio: 10 });
    const [devAntes] = await devolver(sql, n.owner, n.id, antes.sale_id, 'cash');
    await sql`UPDATE sale_returns SET created_at = now() - interval '1 day' WHERE id = ${devAntes.return_id}`;

    const [caja] = await abrir(sql, n.owner, n.id, 50);
    const [durante] = await vender(sql, n.owner, n.id, { producto: p, precio: 10, caja: caja.id });
    const [devDurante] = await devolver(sql, n.owner, n.id, durante.sale_id, 'cash');
    await sql`UPDATE sale_returns SET created_at = now() + interval '1 second' WHERE id = ${devDurante.return_id}`;

    const ruta = join(resolve(__dirname, '../../..'), 'drizzle/migrations/0021_caja_arqueo.sql');
    await sql.unsafe(readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n'));

    const filas = await sql`SELECT id, register_session_id FROM sale_returns WHERE business_id = ${n.id}`;
    const de = (id: string) => filas.find((f) => f.id === id)?.register_session_id ?? null;
    expect(de(devDurante.return_id)).toBe(caja.id);
    expect(de(devAntes.return_id)).toBeNull();

    const [c] = await asUser(sql, n.owner, (tx) => tx`
      SELECT refunds_amount::float FROM public.get_register_summary(${caja.id}) WHERE payment_method = 'cash'`);
    expect(c.refunds_amount).toBe(10);
  });
});
