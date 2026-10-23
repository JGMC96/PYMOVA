// @vitest-environment node
// La cuenta del TPV de la tienda con rol «personal», como TUILUS: dos propietarias (una es
// la cuenta del TPV, que pasa a personal) y una administradora, con PIN. Con el rol personal
// la tienda sigue funcionando: abrir y cerrar caja, vender, devolver, vales y fichar. Lo que
// pesa son los permisos de quien mete el PIN, no los de la cuenta. Lo que solo es de
// propietarios y administradores deja de estar al alcance de la cuenta del TPV.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!RLS_DB_URL)('RLS · cuenta del TPV con rol personal', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string; // propietaria que se queda
  let tpv: string; // cuenta del TPV: hoy propietaria, pasa a personal
  let admin: string;
  let producto: string;
  let empOwner: string;
  let empAdmin: string;
  let ana: string; // dependienta sin cuenta, con permisos por defecto

  const sesion = async (employee: string, pin: string) => {
    const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${employee}, ${pin})`);
    expect(r.ok).toBe(true);
    return r.session_id;
  };

  const autorizar = async (employee: string, pin: string, accion: string, cantidad: number | null = null) => {
    const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; authorization_id: string | null }[]>`
      SELECT * FROM public.authorize_action(${negocio}, ${employee}, ${pin}, ${accion}, ${cantidad})`);
    expect(r.ok).toBe(true);
    return r.authorization_id;
  };

  /** Venta de un zueco de 100 € con descuento (%), desde la cuenta del TPV. */
  const vender = async (
    caja: string,
    vendedor: string,
    opts: { descuento?: number; autorizacion?: string | null; metodo?: string; vale?: string; importeVale?: number } = {},
  ) => {
    const neto = r2(100 * (1 - (opts.descuento ?? 0) / 100));
    const base = r2(neto / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, total: neto }];
    const [r] = await asUser(sql, tpv, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => ${opts.metodo ?? 'card'},
        _subtotal => ${base}, _tax => ${r2(neto - base)}, _total => ${neto}, _discount => ${r2(100 - neto)},
        _register_session_id => ${caja}, _seller_session_id => ${vendedor}, _authorization_id => ${opts.autorizacion ?? null},
        _voucher_code => ${opts.vale ?? null}, _voucher_amount => ${opts.importeVale ?? null})`);
    return r.sale_id;
  };

  const devolver = async (venta: string, vendedor: string, metodo = 'card', autorizacion: string | null = null) => {
    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [r] = await asUser(sql, tpv, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${venta},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, _reason => 'Talla', _refund_method => ${metodo},
        _restock => true, _seller_session_id => ${vendedor}, _authorization_id => ${autorizacion})`);
    return r.return_id;
  };

  const abrir = async (vendedor: string | null) => {
    const [c] = await asUser(sql, tpv, (tx) => tx<{ id: string }[]>`
      SELECT public.open_register_session(_business_id => ${negocio}, _opening_amount => 50,
        _seller_session_id => ${vendedor}) AS id`);
    return c.id;
  };

  const cerrar = (caja: string, vendedor: string | null, autorizacion: string | null = null) =>
    asUser(sql, tpv, (tx) => tx`
      SELECT public.close_register_session(_session_id => ${caja}, _counted_amount => 50, _notes => null,
        _seller_session_id => ${vendedor}, _authorization_id => ${autorizacion})`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Zapatería', null) AS id`);
    negocio = b.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${tpv}, 'owner', true), (${negocio}, ${admin}, 'admin', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, cost_price, stock_quantity, track_inventory)
      VALUES (${negocio}, 'Zueco', 100, 40, 100, true) RETURNING id`;
    producto = p.id;
    // Como en TUILUS: la propietaria y la administradora, con su cuenta y su PIN.
    const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empOwner = eo.id;
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empOwner}, '9999')`);
    const [ea] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empAdmin = ea.id;
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empAdmin}, '2222')`);
    const [a] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    ana = a.id;
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1111')`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('una propietaria pasa la cuenta del TPV a personal; la cuenta no puede deshacerlo', async () => {
    // La administradora no puede tocar a una propietaria.
    const intentoAdmin = await asUser(sql, admin, (tx) => tx`
      UPDATE business_members SET role = 'staff' WHERE business_id = ${negocio} AND user_id = ${tpv} RETURNING id`);
    expect(intentoAdmin).toHaveLength(0);
    // Equipo › rol: lo hace la otra propietaria.
    const cambio = await asUser(sql, owner, (tx) => tx`
      UPDATE business_members SET role = 'staff' WHERE business_id = ${negocio} AND user_id = ${tpv} RETURNING id`);
    expect(cambio).toHaveLength(1);
    const [m] = await sql`SELECT role, is_active FROM business_members WHERE business_id = ${negocio} AND user_id = ${tpv}`;
    expect(m).toEqual({ role: 'staff', is_active: true });
    // Ya como personal, la cuenta no vuelve a subirse de rol.
    const vuelta = await asUser(sql, tpv, (tx) => tx`
      UPDATE business_members SET role = 'owner' WHERE business_id = ${negocio} AND user_id = ${tpv} RETURNING id`);
    expect(vuelta).toHaveLength(0);
    // Y la única propietaria que queda no puede quedarse sin propietario.
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE business_members SET role = 'admin' WHERE business_id = ${negocio} AND user_id = ${owner}`),
    ).rejects.toThrow(/propietario/i);
  });

  it('la jornada: abrir caja, vender, devolver a vale, cobrar con el vale, fichar y cerrar', async () => {
    // Sin PIN no se abre la caja.
    await expect(abrir(null)).rejects.toThrow(/sesión de vendedor/i);
    const sAdmin = await sesion(empAdmin, '2222');
    const caja = await abrir(sAdmin);
    const [c] = await sql`SELECT opened_by_employee_id FROM cash_register_sessions WHERE id = ${caja}`;
    expect(c.opened_by_employee_id).toBe(empAdmin);

    // Con el PIN de la administradora valen sus permisos (todo), no los de la cuenta.
    const venta = await vender(caja, sAdmin, { descuento: 30 });
    const [s] = await sql`SELECT seller_employee_id, created_by, authorized_by_employee_id FROM sales WHERE id = ${venta}`;
    expect(s).toEqual({ seller_employee_id: empAdmin, created_by: tpv, authorized_by_employee_id: null });

    // Devolución a vale de tienda y venta pagada con ese vale.
    const dev = await devolver(venta, sAdmin, 'store_credit');
    const [vale] = await sql<{ code: string }[]>`SELECT code FROM store_vouchers WHERE source_return_id = ${dev}`;
    const [consulta] = await asUser(sql, tpv, (tx) => tx<{ balance: string }[]>`
      SELECT * FROM public.get_store_voucher(${negocio}, ${vale.code})`);
    expect(Number(consulta.balance)).toBe(70);
    const pagada = await vender(caja, sAdmin, { descuento: 30, vale: vale.code, importeVale: 70 });
    const [sv] = await sql`SELECT payment_method, voucher_amount::float AS vale FROM sales WHERE id = ${pagada}`;
    expect(sv).toEqual({ payment_method: 'store_credit', vale: 70 });

    // Fichaje con el PIN: a nombre de quien lo mete.
    const [entrada] = await asUser(sql, tpv, (tx) => tx<{ id: string }[]>`
      SELECT public.clock_action(${negocio}, 'clock_in', null, null, null, ${sAdmin}) AS id`);
    const [te] = await sql`SELECT employee_id, created_by FROM hr_time_entries WHERE id = ${entrada.id}`;
    expect(te).toEqual({ employee_id: empAdmin, created_by: tpv });

    // Cierra quien puede cerrar.
    await cerrar(caja, sAdmin);
    const [cerrada] = await sql`SELECT status, closed_by_employee_id FROM cash_register_sessions WHERE id = ${caja}`;
    expect(cerrada).toEqual({ status: 'closed', closed_by_employee_id: empAdmin });
  });

  it('una dependienta con permisos por defecto: hasta el 10 % sola; lo demás, con el PIN de un encargado', async () => {
    const sAna = await sesion(ana, '1111');
    const caja = await abrir(sAna);
    await vender(caja, sAna, { descuento: 10 });
    await expect(vender(caja, sAna, { descuento: 20 })).rejects.toThrow(/autoriz/i);
    const aut = await autorizar(empOwner, '9999', 'discount', 20);
    const venta = await vender(caja, sAna, { descuento: 20, autorizacion: aut });
    const [s] = await sql`SELECT seller_employee_id, authorized_by_employee_id FROM sales WHERE id = ${venta}`;
    expect(s).toEqual({ seller_employee_id: ana, authorized_by_employee_id: empOwner });

    await expect(devolver(venta, sAna)).rejects.toThrow(/autoriz/i);
    await devolver(venta, sAna, 'card', await autorizar(empAdmin, '2222', 'return'));

    // Caja a ciegas con solo Ana conectada.
    const resumen = await asUser(sql, tpv, (tx) => tx<{ total_amount: string | null }[]>`
      SELECT * FROM public.get_register_summary(${caja}, ${[sAna]}::uuid[])`);
    expect(resumen.every((f) => f.total_amount === null)).toBe(true);
    await expect(cerrar(caja, sAna)).rejects.toThrow(/no puede cerrar la caja/);
    await cerrar(caja, sAna, await autorizar(empOwner, '9999', 'close_register'));

    // Ana ficha con su PIN aunque no tenga cuenta.
    const [entrada] = await asUser(sql, tpv, (tx) => tx<{ id: string }[]>`
      SELECT public.clock_action(${negocio}, 'clock_in', null, null, null, ${sAna}) AS id`);
    const [te] = await sql`SELECT employee_id FROM hr_time_entries WHERE id = ${entrada.id}`;
    expect(te.employee_id).toBe(ana);
  });

  it('lo que la cuenta del TPV deja de poder hacer', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    await expect(
      asUser(sql, tpv, (tx) => tx`SELECT * FROM public.get_sales_by_seller(${negocio}, ${hoy}::date, ${hoy}::date)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, tpv, (tx) => tx`SELECT * FROM public.get_dashboard_metrics(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    // Precios del catálogo, permisos y PIN de otras personas.
    await expect(
      asUser(sql, tpv, (tx) => tx`UPDATE products SET price = 1 WHERE id = ${producto}`),
    ).rejects.toThrow(/permiso/i);
    await expect(
      asUser(sql, tpv, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${ana}, 50, true, true)`),
    ).rejects.toThrow();
    await expect(asUser(sql, tpv, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '0000')`)).rejects.toThrow();
    // Los correos del resto del equipo ya no los ve.
    const equipo = await asUser(sql, tpv, (tx) => tx<{ user_id: string; email: string | null }[]>`
      SELECT user_id, email FROM public.get_business_team(${negocio})`);
    expect(equipo.filter((m) => m.user_id !== tpv).every((m) => m.email === null)).toBe(true);
    // Permisos de la propia cuenta: los del rol personal.
    const [mios] = await asUser(sql, tpv, (tx) => tx<{ can_edit_catalog: boolean; can_see_costs: boolean; can_adjust_stock: boolean }[]>`
      SELECT * FROM public.get_my_permissions(${negocio})`);
    expect(mios).toMatchObject({ can_edit_catalog: false, can_see_costs: false, can_adjust_stock: false });
  });
});
