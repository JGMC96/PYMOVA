// @vitest-environment node
// 0065: pago mixto. Una venta se cobra parte en efectivo y parte con tarjeta; cada forma de pago
// queda en sale_payments (escrita solo por la RPC), el cambio es solo de la parte en efectivo y el
// cajón solo espera esa parte. Sin _payments, todo como antes (y una línea en sale_payments).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };
const NO_VALIDO = { code: '22023' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Pago { method: string; amount: number; cash_received?: number | null }

describe.skipIf(!RLS_DB_URL)('RLS · pago mixto', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let negocio: string;
  let producto: string;
  let caja: string | null = null;

  /** Venta de 129 € (u otro total) con el reparto indicado. */
  const vender = async (opts: {
    total?: number; metodo?: string; pagos?: Pago[] | null; entregado?: number | null; cambio?: number | null;
    vale?: string | null; importeVale?: number | null;
  } = {}) => {
    const total = opts.total ?? 129;
    const base = r2(total / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Botín', quantity: 1, unit_price: total, total }];
    await sql`UPDATE products SET price = ${total} WHERE id = ${producto}`;
    const [r] = await asUser(sql, staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => ${opts.metodo ?? 'mixed'},
        _subtotal => ${base}, _tax => ${r2(total - base)}, _total => ${total}, _discount => 0,
        _cash_received => ${opts.entregado ?? null}, _change_given => ${opts.cambio ?? null},
        _register_session_id => ${caja},
        _voucher_code => ${opts.vale ?? null}, _voucher_amount => ${opts.importeVale ?? null},
        _payments => ${opts.pagos === undefined || opts.pagos === null ? null : sql.json(opts.pagos as never)}::jsonb)`);
    return r.sale_id;
  };
  const pagosDe = (venta: string) =>
    sql<{ method: string; amount: number; cash_received: number | null; change_given: number | null }[]>`
      SELECT method, amount::float AS amount, cash_received::float AS cash_received, change_given::float AS change_given
      FROM sale_payments WHERE sale_id = ${venta} ORDER BY method`;
  const venta = async (id: string) => (await sql<{ payment_method: string; cash_received: number | null; change_given: number | null }[]>`
    SELECT payment_method, cash_received::float AS cash_received, change_given::float AS change_given FROM sales WHERE id = ${id}`)[0];

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'tienda@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await asUser(sql, ajeno, (tx) => tx`SELECT public.create_business('Otra', null)`);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Botín', 129, 500, true) RETURNING id`;
    producto = p.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin caja abierta: con tarjeta sí, con una parte en efectivo no', async () => {
    const v = await vender({ pagos: [{ method: 'card', amount: 129 }] });
    expect((await venta(v)).payment_method).toBe('card');
    await expect(vender({ pagos: [{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }] }))
      .rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('Abre la caja') });
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 100) AS id`);
    caja = c.id;
  });

  it('venta mixta: dos líneas, «mixed» y el cambio solo sobre el efectivo', async () => {
    const v = await vender({ pagos: [{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }], entregado: 60, cambio: 10 });
    expect(await venta(v)).toEqual({ payment_method: 'mixed', cash_received: 60, change_given: 10 });
    expect(await pagosDe(v)).toEqual([
      { method: 'card', amount: 79, cash_received: null, change_given: null },
      { method: 'cash', amount: 50, cash_received: 60, change_given: 10 },
    ]);
  });

  it('sin _payments, como siempre, y con una línea en sale_payments', async () => {
    const v = await vender({ metodo: 'cash', pagos: null, entregado: 150, cambio: 21 });
    expect((await venta(v)).payment_method).toBe('cash');
    expect(await pagosDe(v)).toEqual([{ method: 'cash', amount: 129, cash_received: 150, change_given: 21 }]);
    const t = await vender({ metodo: 'card', pagos: null });
    expect(await pagosDe(t)).toEqual([{ method: 'card', amount: 129, cash_received: null, change_given: null }]);
  });

  it('un reparto que no cuadra o no vale, no se guarda', async () => {
    const antes = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales WHERE business_id = ${negocio}`;
    const casos: [Pago[], string][] = [
      [[{ method: 'card', amount: 79 }, { method: 'cash', amount: 40 }], 'suman 119'],
      [[{ method: 'card', amount: 79 }, { method: 'transfer', amount: 50 }], 'efectivo y tarjeta'],
      [[{ method: 'card', amount: 79 }, { method: 'card', amount: 50 }], 'una vez'],
      [[{ method: 'card', amount: 129 }, { method: 'cash', amount: 0 }], 'mayor que 0'],
    ];
    for (const [pagos, msg] of casos) {
      await expect(vender({ pagos })).rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining(msg) });
    }
    await expect(vender({ pagos: [{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }], entregado: 40 }))
      .rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('parte en efectivo') });
    await expect(vender({ metodo: 'mixed', pagos: null })).rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('cada forma de pago') });
    const despues = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales WHERE business_id = ${negocio}`;
    expect(despues[0].n).toBe(antes[0].n);
  });

  it('con vale: el vale primero y el resto repartido', async () => {
    const [v] = await sql<{ id: string }[]>`
      INSERT INTO store_vouchers (business_id, code, initial_amount, balance, origin) VALUES (${negocio}, 'VALE-MIXTO22', 30, 30, 'import') RETURNING id`;
    const s = await vender({ vale: 'VALE-MIXTO22', importeVale: 29, pagos: [{ method: 'card', amount: 60 }, { method: 'cash', amount: 40 }], entregado: 40, cambio: 0 });
    expect((await venta(s)).payment_method).toBe('mixed');
    expect((await pagosDe(s)).map((p) => [p.method, p.amount])).toEqual([['card', 60], ['cash', 40]]);
    const [saldo] = await sql<{ b: number }[]>`SELECT balance::float AS b FROM store_vouchers WHERE id = ${v.id}`;
    expect(saldo.b).toBe(1);
    // Si el vale lo paga todo, no hay nada que repartir.
    await sql`UPDATE store_vouchers SET balance = 200, initial_amount = 200 WHERE id = ${v.id}`;
    await expect(vender({ vale: 'VALE-MIXTO22', importeVale: 129, pagos: [{ method: 'card', amount: 1 }] }))
      .rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('nada por cobrar') });
  });

  it('la caja solo espera la parte en efectivo, en el resumen y por vendedor', async () => {
    // En esta caja: mixta (50 efectivo + 79 tarjeta), efectivo 129, tarjeta 129, mixta con vale (40 + 60 + vale 29).
    const resumen = await asUser(sql, owner, (tx) => tx<{ payment_method: string; sales_count: string; total_amount: number }[]>`
      SELECT payment_method, sales_count, total_amount::float AS total_amount FROM public.get_register_summary(${caja}) ORDER BY 1`);
    expect(resumen.map((r) => [r.payment_method, Number(r.sales_count), r.total_amount])).toEqual([
      ['card', 3, 79 + 129 + 60],
      ['cash', 3, 50 + 129 + 40],
      ['store_credit', 1, 29],
    ]);
    const porVendedor = await asUser(sql, owner, (tx) => tx<{ sales_count: string; cash_total: number }[]>`
      SELECT sales_count, cash_total::float AS cash_total FROM public.get_register_seller_summary(${caja})`);
    expect(porVendedor.reduce((s, r) => s + Number(r.sales_count), 0)).toBe(4);
    expect(porVendedor.reduce((s, r) => s + r.cash_total, 0)).toBe(219);
    // Cierre: 100 de fondo + 219 en efectivo.
    await asUser(sql, owner, (tx) => tx`SELECT public.close_register_session(${caja}, 319, null)`);
    const [c] = await sql<{ expected: number; diff: number }[]>`
      SELECT expected_amount::float AS expected, difference::float AS diff FROM cash_register_sessions WHERE id = ${caja}`;
    expect(c).toEqual({ expected: 319, diff: 0 });
  });

  it('el informe de ventas reparte la mixta por forma de pago', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const [r] = await asUser(sql, owner, (tx) => tx<{ j: { by_payment: { m: string; cur_sales: number }[] } }[]>`
      SELECT public.get_sales_report(${negocio}, ${hoy}::date, ${hoy}::date) AS j`);
    const porForma = Object.fromEntries(r.j.by_payment.map((p) => [p.m, Number(p.cur_sales)]));
    expect(porForma).toMatchObject({ card: 129 + 79 + 129 + 60, cash: 50 + 129 + 40, store_credit: 29 });
    expect(porForma.mixed).toBeUndefined();
  });

  it('las formas de pago se leen en el negocio; fuera no, y nadie las escribe a mano', async () => {
    const [v] = await sql<{ id: string }[]>`SELECT id FROM sales WHERE business_id = ${negocio} AND payment_method = 'mixed' LIMIT 1`;
    const propias = await asUser(sql, staff, (tx) => tx`SELECT method FROM sale_payments WHERE sale_id = ${v.id}`);
    expect(propias).toHaveLength(2);
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT method FROM sale_payments`)).resolves.toHaveLength(0);
    await expect(asAnon(sql, (tx) => tx`SELECT method FROM sale_payments`)).rejects.toMatchObject(DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`
      INSERT INTO sale_payments (business_id, sale_id, method, amount) VALUES (${negocio}, ${v.id}, 'other', 1)`)).rejects.toMatchObject(DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`UPDATE sale_payments SET amount = 1 WHERE sale_id = ${v.id}`)).rejects.toMatchObject(DENEGADO);
    const [f] = await sql<{ auth: boolean; anon: boolean; helper: boolean }[]>`
      SELECT has_function_privilege('authenticated', 'public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric, jsonb)', 'EXECUTE') AS auth,
             has_function_privilege('anon', 'public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric, jsonb)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.sale_method_amount(public.sales, text)', 'EXECUTE') AS helper`;
    expect(f).toEqual({ auth: true, anon: false, helper: false });
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'create_sale_with_items'`;
    expect(n.n).toBe(1);
  });

  it('las ventas anteriores se copian a sale_payments, y la migración se puede aplicar otra vez', async () => {
    // Ventas «antiguas» escritas a mano, sin formas de pago: tarjeta, efectivo con vale y todo con vale.
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, subtotal, tax, total, payment_method)
      VALUES (${negocio}, 'VTA-OLD1', 41.32, 8.68, 50, 'card') RETURNING id`;
    const [b] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, subtotal, tax, total, payment_method, voucher_amount, cash_received, change_given)
      VALUES (${negocio}, 'VTA-OLD2', 41.32, 8.68, 50, 'cash', 20, 40, 10) RETURNING id`;
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, subtotal, tax, total, payment_method, voucher_amount)
      VALUES (${negocio}, 'VTA-OLD3', 41.32, 8.68, 50, 'store_credit', 50) RETURNING id`;
    const migracion = readFileSync(resolve(process.cwd(), 'drizzle/migrations/0065_0065_pago_mixto.sql'), 'utf8');
    await sql.unsafe(migracion);
    await sql.unsafe(migracion);
    expect(await pagosDe(a.id)).toEqual([{ method: 'card', amount: 50, cash_received: null, change_given: null }]);
    expect(await pagosDe(b.id)).toEqual([{ method: 'cash', amount: 30, cash_received: 40, change_given: 10 }]);
    expect(await pagosDe(c.id)).toEqual([]);
    // Las mixtas ya hechas siguen con sus dos líneas, sin duplicar.
    const [m] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.payment_method = 'mixed'`;
    expect(m.n).toBe(4);
  });
});
