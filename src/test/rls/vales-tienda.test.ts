// @vitest-environment node
// Vales de tienda (0039): al devolver con «Vale de tienda» se crea un vale con código y un año
// de caducidad; en el TPV se paga con él todo o parte (el resto con otro método) y la caja no lo
// cuenta como efectivo. Solo el propietario o un administrador lo anulan. Se escribe por RPC.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Vale {
  id: string;
  code: string;
  initial_amount: string;
  balance: string;
  status: string;
  expires_at: Date;
  expired: boolean;
}

describe.skipIf(!RLS_DB_URL)('RLS · vales de tienda', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otroNegocio: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let ajeno: string;
  let producto: string;
  let caja: string;

  /** Venta de `uds` zuecos de 100 € con pago opcional con vale. */
  const vender = async (
    opts: { uds?: number; metodo?: string; vale?: string | null; importeVale?: number | null; entregado?: number | null; user?: string } = {},
  ) => {
    const uds = opts.uds ?? 1;
    const total = 100 * uds;
    const base = r2(total / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Zueco', quantity: uds, unit_price: 100, total }];
    const [r] = await asUser(sql, opts.user ?? staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => ${opts.metodo ?? 'cash'},
        _subtotal => ${base}, _tax => ${r2(total - base)}, _total => ${total}, _discount => 0,
        _cash_received => ${opts.entregado ?? null}, _register_session_id => ${caja},
        _voucher_code => ${opts.vale ?? null}, _voucher_amount => ${opts.importeVale ?? null})`);
    return r.sale_id;
  };

  /** Devuelve toda la venta con el método indicado; devuelve el id de la devolución. */
  const devolver = async (venta: string, metodo = 'store_credit') => {
    const [item] = await sql`SELECT id, quantity FROM sale_items WHERE sale_id = ${venta}`;
    const [r] = await asUser(sql, staff, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${venta},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: Number(item.quantity) }])}::jsonb,
        _reason => 'Talla', _refund_method => ${metodo}, _restock => true)`);
    return r.return_id;
  };

  const valeDe = async (devolucion: string) => {
    const [v] = await sql<{ code: string }[]>`SELECT code FROM store_vouchers WHERE source_return_id = ${devolucion}`;
    return v.code;
  };

  const consultar = async (codigo: string, user = staff) =>
    (await asUser(sql, user, (tx) => tx<Vale[]>`SELECT * FROM public.get_store_voucher(${negocio}, ${codigo})`))[0];

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'tienda@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = o.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 100, 100, true) RETURNING id`;
    producto = p.id;
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('devolver con «Vale de tienda» crea un vale por lo devuelto, con código y un año de validez', async () => {
    const venta = await vender({ metodo: 'card' });
    const dev = await devolver(venta);
    const codigo = await valeDe(dev);
    expect(codigo).toMatch(/^VALE-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    const v = await consultar(codigo.toLowerCase());
    expect(v).toMatchObject({ code: codigo, status: 'active', expired: false });
    expect(Number(v.initial_amount)).toBe(100);
    expect(Number(v.balance)).toBe(100);
    const dias = (v.expires_at.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(364);
    expect(dias).toBeLessThan(367);
    const movs = await sql`SELECT kind, amount::float AS amount, balance_after::float AS saldo, return_id FROM store_voucher_movements WHERE voucher_id = ${v.id}`;
    expect(movs).toEqual([{ kind: 'issue', amount: 100, saldo: 100, return_id: dev }]);
    // Con otro método de reembolso no hay vale.
    const otra = await vender({ metodo: 'card' });
    const devCash = await devolver(otra, 'card');
    expect(await sql`SELECT 1 FROM store_vouchers WHERE source_return_id = ${devCash}`).toEqual([]);
  });

  it('paga parte con el vale y el resto en efectivo; lo que sobra se queda de saldo', async () => {
    const codigo = await valeDe(await devolver(await vender({ metodo: 'card' })));
    // 2 zuecos (200 €): 60 € con el vale y 140 € en efectivo.
    await expect(vender({ uds: 2, vale: codigo, importeVale: 60, entregado: 130 })).rejects.toThrow(/efectivo recibido es menor/);
    const venta = await vender({ uds: 2, vale: codigo, importeVale: 60, entregado: 150 });
    const [s] = await sql`SELECT payment_method, voucher_amount::float AS vale, total::float AS total FROM sales WHERE id = ${venta}`;
    expect(s).toEqual({ payment_method: 'cash', vale: 60, total: 200 });
    const v = await consultar(codigo);
    expect(Number(v.balance)).toBe(40);
    expect(v.status).toBe('active');
    // Con los 40 € que quedan paga entero un zueco de 100 €: no, solo llega a 40.
    await expect(vender({ vale: codigo, importeVale: 100, metodo: 'card' })).rejects.toThrow(/solo tiene 40\.00 € de saldo/);
    await expect(vender({ vale: codigo, importeVale: 40, metodo: 'store_credit' })).rejects.toThrow(/Faltan 60\.00 € por cobrar/);
    await vender({ vale: codigo, importeVale: 40, metodo: 'card' });
    const gastado = await consultar(codigo);
    expect(gastado).toMatchObject({ status: 'used' });
    expect(Number(gastado.balance)).toBe(0);
    await expect(vender({ vale: codigo, importeVale: 1, metodo: 'card' })).rejects.toThrow(/solo tiene 0\.00 € de saldo/);
    const movs = await sql`SELECT kind, amount::float AS amount, balance_after::float AS saldo FROM store_voucher_movements
      WHERE voucher_id = ${gastado.id} ORDER BY created_at, kind`;
    expect(movs).toEqual([
      { kind: 'issue', amount: 100, saldo: 100 },
      { kind: 'redeem', amount: -60, saldo: 40 },
      { kind: 'redeem', amount: -40, saldo: 0 },
    ]);
  });

  it('pagada entera con vale, la venta queda como «Vale» aunque llegue otro método', async () => {
    const codigo = await valeDe(await devolver(await vender({ uds: 2, metodo: 'card' })));
    // El vale (200 €) no paga más que el total de la venta (100 €).
    await expect(vender({ vale: codigo, importeVale: 150, metodo: 'card' })).rejects.toThrow(/más que el total/);
    const venta = await vender({ vale: codigo, importeVale: 100, metodo: 'cash' });
    const [s] = await sql`SELECT payment_method, voucher_amount::float AS vale FROM sales WHERE id = ${venta}`;
    expect(s).toEqual({ payment_method: 'store_credit', vale: 100 });
  });

  it('rechaza vales que no existen, de otro negocio, caducados o anulados', async () => {
    await expect(vender({ vale: 'VALE-NOEXISTE', importeVale: 10, metodo: 'card' })).rejects.toThrow(/No hay ningún vale/);
    await expect(vender({ vale: null, importeVale: 10, metodo: 'card' })).rejects.toThrow(/Indica el vale/);
    await expect(vender({ vale: 'VALE-ALGO', importeVale: 0, metodo: 'card' })).rejects.toThrow(/Indica el vale/);

    const caducado = await valeDe(await devolver(await vender({ metodo: 'card' })));
    await sql`UPDATE store_vouchers SET expires_at = now() - interval '1 day' WHERE code = ${caducado}`;
    expect((await consultar(caducado)).expired).toBe(true);
    await expect(vender({ vale: caducado, importeVale: 10, metodo: 'card' })).rejects.toThrow(/caducó el/);

    const anulado = await valeDe(await devolver(await vender({ metodo: 'card' })));
    const v = await consultar(anulado);
    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.void_store_voucher(${negocio}, ${v.id}, 'Error')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, admin, (tx) => tx`SELECT public.void_store_voucher(${negocio}, ${v.id}, '  ')`)).rejects.toThrow(/motivo/);
    await asUser(sql, admin, (tx) => tx`SELECT public.void_store_voucher(${negocio}, ${v.id}, 'Duplicado')`);
    const tras = await consultar(anulado);
    expect(tras.status).toBe('void');
    expect(Number(tras.balance)).toBe(0);
    await expect(vender({ vale: anulado, importeVale: 10, metodo: 'card' })).rejects.toThrow(/está anulado/);
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.void_store_voucher(${negocio}, ${v.id}, 'Otra vez')`)).rejects.toThrow(/ya está anulado/);
  });

  it('nadie escribe los vales a mano y cada negocio solo ve los suyos', async () => {
    const codigo = await valeDe(await devolver(await vender({ metodo: 'card' })));
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE store_vouchers SET balance = 999 WHERE code = ${codigo}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, owner, (tx) => tx`INSERT INTO store_vouchers (business_id, code, initial_amount, balance) VALUES (${negocio}, 'VALE-FALSO1', 50, 50)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Las ventas tampoco se tocan a mano: la RLS no deja cambiar ninguna.
    expect(await asUser(sql, owner, (tx) => tx`UPDATE sales SET voucher_amount = 0 RETURNING id`)).toEqual([]);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM store_vouchers`)).rejects.toMatchObject(PERMISO_DENEGADO);
    expect(await asUser(sql, ajeno, (tx) => tx`SELECT id FROM store_vouchers`)).toEqual([]);
    expect(await asUser(sql, ajeno, (tx) => tx`SELECT id FROM store_voucher_movements`)).toEqual([]);
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.get_store_voucher(${negocio}, ${codigo})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Desde otro negocio el código no existe.
    expect(await asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.get_store_voucher(${otroNegocio}, ${codigo})`)).toEqual([]);
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT public.generate_store_voucher_code(${otroNegocio})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('la caja separa lo pagado con vale y no lo cuenta como efectivo', async () => {
    // Caja nueva para contar solo lo de este test.
    await asUser(sql, owner, (tx) => tx`SELECT public.close_register_session(${caja}, 0)`);
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    const codigo = await valeDe(await devolver(await vender({ uds: 2, metodo: 'card' }))); // vale de 200 €; devolución con vale, no sale del cajón
    await vender({ uds: 2, vale: codigo, importeVale: 30 }); // 30 vale + 170 efectivo
    await vender({ vale: codigo, importeVale: 100 }); // entera con vale
    await vender({ metodo: 'card' }); // 100 tarjeta
    const resumen = await asUser(sql, owner, (tx) => tx`
      SELECT payment_method, sales_count::int AS ventas, total_amount::float AS importe, refunds_count::int AS devoluciones, refunds_amount::float AS devuelto
      FROM public.get_register_summary(${caja}) ORDER BY payment_method`);
    expect(resumen).toEqual([
      { payment_method: 'card', ventas: 2, importe: 300, devoluciones: 0, devuelto: 0 },
      { payment_method: 'cash', ventas: 1, importe: 170, devoluciones: 0, devuelto: 0 },
      { payment_method: 'store_credit', ventas: 2, importe: 130, devoluciones: 1, devuelto: 200 },
    ]);
    await asUser(sql, owner, (tx) => tx`SELECT public.close_register_session(${caja}, 220)`);
    const [cerrada] = await sql`SELECT expected_amount::float AS esperado, difference::float AS diferencia FROM cash_register_sessions WHERE id = ${caja}`;
    expect(cerrada).toEqual({ esperado: 220, diferencia: 0 });
  });
});
