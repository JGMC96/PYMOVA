// @vitest-environment node
// Permisos por persona en el TPV (0030): descuento máximo, devoluciones y cierre de caja
// según la persona identificada con PIN; sin permiso, autorización de un solo uso con el
// PIN de alguien que lo tenga. Solo el propietario cambia permisos. Caja a ciegas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb, type Tx } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Permisos {
  employee_id: string;
  name: string;
  is_owner: boolean;
  has_account: boolean;
  customized: boolean;
  max_discount_pct: string;
  can_return: boolean;
  can_close_register: boolean;
}

describe.skipIf(!RLS_DB_URL)('RLS · permisos por persona en el TPV', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let tpv: string; // cuenta con la que está abierto el TPV de la tienda
  let producto: string;
  let caja: string;
  let empOwner: string;
  let ana: string; // dependienta: permisos por defecto
  let luis: string; // encargado: 30 %, devoluciones y caja

  const sesion = async (employee: string, pin: string, user = tpv) => {
    const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${employee}, ${pin})`);
    expect(r.ok).toBe(true);
    return r.session_id;
  };

  const autorizar = async (employee: string, pin: string, accion: string, cantidad: number | null = null, user = tpv) => {
    const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; error: string | null; authorization_id: string | null }[]>`
      SELECT * FROM public.authorize_action(${negocio}, ${employee}, ${pin}, ${accion}, ${cantidad})`);
    return r;
  };

  /** Venta de un artículo de 100 € con descuento (%). */
  const vender = async (vendedor: string, descuentoPct: number, autorizacion: string | null = null, user = tpv) => {
    const neto = r2(100 * (1 - descuentoPct / 100));
    const base = r2(neto / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, total: neto }];
    const [r] = await asUser(sql, user, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => ${base}, _tax => ${r2(neto - base)}, _total => ${neto}, _discount => ${r2(100 - neto)},
        _register_session_id => ${caja}, _seller_session_id => ${vendedor}, _authorization_id => ${autorizacion})`);
    return r.sale_id;
  };

  const devolver = async (venta: string, vendedor: string, autorizacion: string | null = null) => {
    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [r] = await asUser(sql, tpv, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${venta},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, _reason => 'Talla', _refund_method => 'cash',
        _restock => true, _seller_session_id => ${vendedor}, _authorization_id => ${autorizacion})`);
    return r.return_id;
  };

  const permisos = async (user = tpv) =>
    (await asUser(sql, user, (tx) => tx<Permisos[]>`SELECT * FROM public.get_pos_permissions(${negocio})`));

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${tpv}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 100, 100, true) RETURNING id`;
    producto = p.id;
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empOwner = eo.id;
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empOwner}, '9999')`);
    const [a] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    ana = a.id;
    const [l] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Luis') AS id`);
    luis = l.id;
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1111')`);
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${luis}, '2222')`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('por defecto: propietario y administradores, todo; dependientes, 10 % y nada más', async () => {
    const [ea] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    const lista = await permisos();
    const de = (id: string) => lista.find((p) => p.employee_id === id)!;
    expect(de(empOwner)).toMatchObject({ is_owner: true, can_return: true, can_close_register: true });
    expect(Number(de(empOwner).max_discount_pct)).toBe(100);
    expect(de(ea.id)).toMatchObject({ is_owner: false, can_return: true, can_close_register: true });
    expect(Number(de(ea.id).max_discount_pct)).toBe(100);
    expect(de(ana)).toMatchObject({ is_owner: false, has_account: false, customized: false, can_return: false, can_close_register: false });
    expect(Number(de(ana).max_discount_pct)).toBe(10);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.get_pos_permissions(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('solo el propietario cambia permisos, nunca los de un propietario', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${luis}, 30, true, true)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${empOwner}, 0, false, false)`),
    ).rejects.toThrow(/propietario no se pueden cambiar/);
    await expect(
      asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${luis}, 120, true, true)`),
    ).rejects.toThrow(/entre 0 y 100/);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${luis}, 30, true, true)`);
    const luisP = (await permisos()).find((p) => p.employee_id === luis)!;
    expect(luisP).toMatchObject({ customized: true, can_return: true, can_close_register: true });
    expect(Number(luisP.max_discount_pct)).toBe(30);
    // Nadie escribe la tabla directamente.
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE hr_employee_permissions SET max_discount_pct = 100 WHERE employee_id = ${luis}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('descuento dentro del tope sin más; por encima, con la autorización de alguien con tope suficiente', async () => {
    const sAna = await sesion(ana, '1111');
    const v10 = await vender(sAna, 10);
    const [v] = await sql`SELECT seller_employee_id, authorized_by_employee_id FROM sales WHERE id = ${v10}`;
    expect(v).toEqual({ seller_employee_id: ana, authorized_by_employee_id: null });

    await expect(vender(sAna, 20)).rejects.toThrow(/Necesita autorización: el descuento es del 20\.00 %/);
    // Ana no puede autorizarse a sí misma; Luis sí hasta el 30 %.
    expect(await autorizar(ana, '1111', 'discount', 20)).toMatchObject({ ok: false, authorization_id: null });
    expect((await autorizar(luis, '2222', 'discount', 40)).ok).toBe(false);
    expect((await autorizar(luis, '0000', 'discount', 20)).error).toBe('PIN incorrecto');
    const ok = await autorizar(luis, '2222', 'discount', 20);
    expect(ok.ok).toBe(true);
    const v20 = await vender(sAna, 20, ok.authorization_id);
    const [w] = await sql`SELECT authorized_by_employee_id FROM sales WHERE id = ${v20}`;
    expect(w.authorized_by_employee_id).toBe(luis);
    // Usada una vez, ya no vale.
    await expect(vender(sAna, 20, ok.authorization_id)).rejects.toThrow(/no es válida o ha caducado/);
  });

  it('una autorización solo vale para su acción, su importe, su cuenta y 2 minutos', async () => {
    const sAna = await sesion(ana, '1111');
    const deDevolucion = await autorizar(luis, '2222', 'return');
    await expect(vender(sAna, 20, deDevolucion.authorization_id)).rejects.toThrow(/no es válida/);
    const corta = await autorizar(luis, '2222', 'discount', 15);
    await expect(vender(sAna, 20, corta.authorization_id)).rejects.toThrow(/no es válida/);
    const caducada = await autorizar(luis, '2222', 'discount', 20);
    await sql`UPDATE pos_authorizations SET expires_at = now() - interval '1 second' WHERE id = ${caducada.authorization_id}`;
    await expect(vender(sAna, 20, caducada.authorization_id)).rejects.toThrow(/no es válida/);
    // Pedida desde otra cuenta del negocio.
    const ajena = await autorizar(luis, '2222', 'discount', 20, admin);
    await expect(vender(sAna, 20, ajena.authorization_id)).rejects.toThrow(/no es válida/);
    // Las autorizaciones no se leen desde el cliente.
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM pos_authorizations`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('devolución: sin permiso necesita autorización y queda registrado quién autorizó', async () => {
    const sAna = await sesion(ana, '1111');
    const venta = await vender(sAna, 0);
    await expect(devolver(venta, sAna)).rejects.toThrow(/Necesita autorización: esta persona no puede hacer devoluciones/);
    const aut = await autorizar(luis, '2222', 'return');
    const dev = await devolver(venta, sAna, aut.authorization_id);
    const [r] = await sql`SELECT seller_employee_id, authorized_by_employee_id FROM sale_returns WHERE id = ${dev}`;
    expect(r).toEqual({ seller_employee_id: ana, authorized_by_employee_id: luis });
    // Luis tiene permiso propio: devuelve sin autorización.
    const sLuis = await sesion(luis, '2222');
    const otra = await vender(sLuis, 0);
    await devolver(otra, sLuis);
  });

  it('caja a ciegas sin nadie que pueda cerrar; el cierre exige persona y permiso o autorización', async () => {
    const sAna = await sesion(ana, '1111');
    const resumen = (ids: string[]) =>
      asUser(sql, tpv, (tx: Tx) => tx<{ payment_method: string; total_amount: string | null }[]>`
        SELECT * FROM public.get_register_summary(${caja}, ${ids}::uuid[])`);
    const ciego = await resumen([sAna]);
    expect(ciego.length).toBeGreaterThan(0);
    expect(ciego.every((f) => f.total_amount === null)).toBe(true);
    const sLuis = await sesion(luis, '2222');
    const visto = await resumen([sAna, sLuis]);
    expect(visto.every((f) => f.total_amount !== null)).toBe(true);
    // Una sesión de otra cuenta no destapa nada.
    const sLuisAdmin = await sesion(luis, '2222', admin);
    expect((await resumen([sAna, sLuisAdmin])).every((f) => f.total_amount === null)).toBe(true);

    const cerrar = (vendedor: string | null, autorizacion: string | null = null) =>
      asUser(sql, tpv, (tx) => tx`
        SELECT public.close_register_session(_session_id => ${caja}, _counted_amount => 100, _notes => null,
          _seller_session_id => ${vendedor}, _authorization_id => ${autorizacion})`);
    await expect(cerrar(null)).rejects.toThrow(/sesión de vendedor/i);
    await expect(cerrar(sAna)).rejects.toThrow(/no puede cerrar la caja/);
    const aut = await autorizar(luis, '2222', 'close_register');
    await cerrar(sAna, aut.authorization_id);
    const [c] = await sql`SELECT status, closed_by_employee_id, close_authorized_by_employee_id FROM cash_register_sessions WHERE id = ${caja}`;
    expect(c).toEqual({ status: 'closed', closed_by_employee_id: ana, close_authorized_by_employee_id: luis });
    // Cerrada, el resumen se ve.
    expect((await resumen([])).every((f) => f.total_amount !== null)).toBe(true);
  });

  it('un administrador no pone el PIN de un propietario; el propietario sí', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empOwner}, '1234')`),
    ).rejects.toThrow(/propietario/);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empOwner}, '9999')`);
    // A un dependiente sí se lo sigue poniendo.
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1111')`);
  });
});
