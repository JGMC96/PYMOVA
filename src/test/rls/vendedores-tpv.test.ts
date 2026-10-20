// @vitest-environment node
// Vendedores en el TPV: dependientes con o sin cuenta, PIN cifrado, sesión de
// vendedor ligada a quien tiene el TPV abierto, vendedor en ventas, devoluciones y
// fichajes, reasignación por admins con motivo e informe por vendedor (solo el
// propietario, 0029).
// 0028: con dependientes con PIN no se vende ni se devuelve sin sesión de vendedor;
// la sesión dura 3 horas; cada uno puede cambiar su PIN con el actual.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Inicio {
  ok: boolean;
  error: string | null;
  locked_seconds: number;
  session_id: string | null;
  employee_id: string | null;
  name: string | null;
}

describe.skipIf(!RLS_DB_URL)('RLS · vendedores en el TPV', () => {
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
  let ana: string; // dependienta sin cuenta
  let empleadoStaff: string; // empleado con cuenta (staff)

  const empezar = async (user: string, employee: string, pin: string, biz = negocio) => {
    const [r] = await asUser(sql, user, (tx) => tx<Inicio[]>`
      SELECT * FROM public.start_seller_session(${biz}, ${employee}, ${pin})`);
    return r;
  };

  const vender = async (user: string, sesion: string | null, precio = 10) => {
    const base = r2(precio / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Artículo', quantity: 1, unit_price: precio, total: precio }];
    const [r] = await asUser(sql, user, (tx) => tx<{ sale_id: string; sale_number: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => ${base}, _tax => ${r2(precio - base)}, _total => ${precio},
        _register_session_id => ${caja}, _seller_session_id => ${sesion})`);
    return r.sale_id;
  };

  const vendedorDe = async (venta: string) => {
    const [r] = await sql`SELECT seller_employee_id FROM sales WHERE id = ${venta}`;
    return r.seller_employee_id as string | null;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [b2] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = b2.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 10, 100, true) RETURNING id`;
    producto = p.id;
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    // El staff tiene su empleado de RR. HH. (como al fichar o al «Sincronizar miembros»).
    const [e] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empleadoStaff = e.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('un admin da de alta a una dependienta sin cuenta; el staff no puede', async () => {
    const [r] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
      SELECT public.upsert_pos_employee(${negocio}, null, '  Ana  ') AS id`);
    ana = r.id;
    const [fila] = await sql`SELECT user_id, display_name, is_active FROM hr_employees WHERE id = ${ana}`;
    expect(fila).toEqual({ user_id: null, display_name: 'Ana', is_active: true });

    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, null, 'Pepe')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, null, 'A')`),
    ).rejects.toThrow(/entre 2 y 60/);
    // Sin cuenta hace falta nombre, también escribiendo en la tabla.
    await expect(sql`INSERT INTO hr_employees (business_id, user_id) VALUES (${negocio}, null)`).rejects.toThrow(
      /hr_employees_name_or_account/,
    );
  });

  it('el PIN se guarda cifrado y nadie lo lee desde el cliente', async () => {
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1234')`);
    const [k] = await sql`SELECT pin_hash FROM hr_employee_pins WHERE employee_id = ${ana}`;
    expect(k.pin_hash).toMatch(/^\$2a\$10\$/);
    expect(k.pin_hash).not.toContain('1234');

    for (const como of [
      (fn: (tx: Parameters<Parameters<typeof asAnon>[1]>[0]) => Promise<unknown>) => asAnon(sql, fn),
      (fn: (tx: Parameters<Parameters<typeof asAnon>[1]>[0]) => Promise<unknown>) => asUser(sql, admin, fn),
    ]) {
      await expect(como((tx) => tx`SELECT * FROM hr_employee_pins`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(como((tx) => tx`SELECT * FROM pos_seller_sessions`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(como((tx) => tx`SELECT public.seller_from_session(${negocio}, gen_random_uuid())`)).rejects.toMatchObject(
        PERMISO_DENEGADO,
      );
    }

    // La lista del TPV dice si hay PIN, pero no cuál.
    const lista = await asUser(sql, staff, (tx) => tx`SELECT * FROM public.get_pos_employees(${negocio})`);
    const fila = lista.find((e) => e.id === ana);
    expect(fila).toMatchObject({ name: 'Ana', has_pin: true, has_account: false, is_active: true });
    expect(Object.keys(fila!)).not.toContain('pin_hash');
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.get_pos_employees(${negocio})`)).resolves.toHaveLength(0);
  });

  it('el PIN de otro solo lo pone un admin; cada miembro puede ponerse el suyo', async () => {
    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '5555')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '12')`),
    ).rejects.toThrow(/4 y 6 cifras/);
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, 'abcd')`),
    ).rejects.toThrow(/4 y 6 cifras/);
    await asUser(sql, staff, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empleadoStaff}, '2468')`);
    expect((await empezar(staff, empleadoStaff, '2468')).ok).toBe(true);
  });

  it('PIN incorrecto: respuesta genérica, bloqueo al 5.º fallo y desbloqueo con el correcto', async () => {
    for (let i = 0; i < 4; i++) {
      expect(await empezar(staff, ana, '0000')).toMatchObject({ ok: false, error: 'PIN incorrecto', locked_seconds: 0 });
    }
    const quinto = await empezar(staff, ana, '0000');
    expect(quinto.ok).toBe(false);
    expect(quinto.error).toMatch(/Demasiados intentos/);
    expect(quinto.locked_seconds).toBeGreaterThan(0);
    // Bloqueada: ni con el PIN correcto.
    expect((await empezar(staff, ana, '1234')).error).toMatch(/Demasiados intentos/);
    // Un empleado inexistente o de otro negocio responde igual que un PIN incorrecto.
    expect((await empezar(staff, '00000000-0000-0000-0000-000000000000', '1234')).error).toBe('PIN incorrecto');

    await sql`UPDATE hr_employee_pins SET locked_until = now() - interval '1 second' WHERE employee_id = ${ana}`;
    const bien = await empezar(staff, ana, '1234');
    expect(bien).toMatchObject({ ok: true, employee_id: ana, name: 'Ana' });
    expect(bien.session_id).toBeTruthy();
    const [k] = await sql`SELECT failed_attempts, locked_until FROM hr_employee_pins WHERE employee_id = ${ana}`;
    expect(k).toEqual({ failed_attempts: 0, locked_until: null });
  });

  it('la venta queda a nombre de la sesión, que dura 3 horas; sin sesión no se vende', async () => {
    const inicio = await empezar(staff, ana, '1234');
    expect(await vendedorDe(await vender(staff, inicio.session_id))).toBe(ana);
    const [s] = await sql`SELECT extract(epoch FROM expires_at - created_at)::int AS seg FROM pos_seller_sessions WHERE id = ${inicio.session_id}`;
    expect(s.seg).toBe(3 * 3600);
    // Con dependientes con PIN, nadie vende sin identificarse: ni el staff ni el owner.
    await expect(vender(staff, null)).rejects.toThrow(/sesión de vendedor/i);
    await expect(vender(owner, null)).rejects.toThrow(/sesión de vendedor/i);
  });

  it('en un negocio sin dependientes con PIN se sigue vendiendo sin sesión, a nombre de la cuenta', async () => {
    const duena = await createUser(sql, 'duena-sin-pin@ejemplo.test');
    const [b] = await asUser(sql, duena, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Sin PIN', null) AS id`);
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${b.id}, 'Calcetín', 6, 10, true) RETURNING id`;
    const [e] = await asUser(sql, duena, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${b.id}) AS id`);
    const base = r2(6 / (1 + IVA / 100));
    const items = [{ product_id: p.id, variant_id: null, product_name: 'Calcetín', quantity: 1, unit_price: 6, total: 6 }];
    const [v] = await asUser(sql, duena, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${b.id}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'card',
        _subtotal => ${base}, _tax => ${r2(6 - base)}, _total => 6)`);
    expect(await vendedorDe(v.sale_id)).toBe(e.id);
  });

  it('la sesión solo vale para quien la abrió, en su negocio y hasta que caduca', async () => {
    const sesion = (await empezar(staff, ana, '1234')).session_id!;
    // Otra cuenta del mismo negocio no puede usarla.
    await expect(vender(admin, sesion)).rejects.toThrow(/sesión de vendedor/i);
    // Una sesión inventada tampoco.
    await expect(vender(staff, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/sesión de vendedor/i);
    // Caducada.
    await sql`UPDATE pos_seller_sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sesion}`;
    await expect(vender(staff, sesion)).rejects.toThrow(/sesión de vendedor/i);
    // Cerrada por quien la abrió.
    const viva = (await empezar(staff, ana, '1234')).session_id!;
    await asUser(sql, admin, (tx) => tx`SELECT public.end_seller_session(${viva})`);
    expect(await vendedorDe(await vender(staff, viva))).toBe(ana);
    await asUser(sql, staff, (tx) => tx`SELECT public.end_seller_session(${viva})`);
    await expect(vender(staff, viva)).rejects.toThrow(/sesión de vendedor/i);
    // Un PIN nuevo o la baja cierran las sesiones abiertas.
    const s2 = (await empezar(staff, ana, '1234')).session_id!;
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1234')`);
    await expect(vender(staff, s2)).rejects.toThrow(/sesión de vendedor/i);
    const s3 = (await empezar(staff, ana, '1234')).session_id!;
    await asUser(sql, admin, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, ${ana}, 'Ana', false)`);
    await expect(vender(staff, s3)).rejects.toThrow(/sesión de vendedor/i);
    expect((await empezar(staff, ana, '1234')).error).toBe('PIN incorrecto');
    await asUser(sql, admin, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, ${ana}, 'Ana López', true)`);
    expect((await empezar(staff, ana, '1234')).name).toBe('Ana López');
  });

  it('la devolución y el fichaje con sesión quedan a nombre de la dependienta', async () => {
    const sesion = (await empezar(staff, ana, '1234')).session_id!;
    const venta = await vender(staff, sesion);
    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [dev] = await asUser(sql, staff, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(${negocio}, ${venta}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb,
        'Talla', 'cash', true, ${sesion})`);
    const [r] = await sql`SELECT seller_employee_id FROM sale_returns WHERE id = ${dev.return_id}`;
    expect(r.seller_employee_id).toBe(ana);
    // Sin sesión no hay devolución.
    const venta2 = await vender(staff, sesion);
    const [item2] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta2}`;
    await expect(
      asUser(sql, staff, (tx) => tx`
        SELECT * FROM public.create_sale_return(${negocio}, ${venta2}, ${sql.json([{ sale_item_id: item2.id, quantity: 1 }])}::jsonb, 'Talla', 'card', true)`),
    ).rejects.toThrow(/sesión de vendedor/i);

    const [entrada] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`
      SELECT public.clock_action(${negocio}, 'clock_in', null, null, null, ${sesion}) AS id`);
    const [te] = await sql`SELECT employee_id, created_by FROM hr_time_entries WHERE id = ${entrada.id}`;
    expect(te).toEqual({ employee_id: ana, created_by: staff });
    const [ws] = await sql`SELECT count(*)::int AS n FROM hr_work_sessions WHERE employee_id = ${ana} AND status = 'open'`;
    expect(ws.n).toBe(1);
    // Sin sesión, el fichaje sigue siendo el de la cuenta.
    await asUser(sql, staff, (tx) => tx`SELECT public.clock_action(${negocio}, 'clock_in')`);
    const [mio] = await sql`SELECT count(*)::int AS n FROM hr_work_sessions WHERE employee_id = ${empleadoStaff} AND status = 'open'`;
    expect(mio.n).toBe(1);
  });

  it('nadie cambia el vendedor escribiendo en la tabla; reasignar es de admins, con motivo y rastro', async () => {
    const venta = await vender(staff, (await empezar(staff, empleadoStaff, '2468')).session_id);
    const directo = await asUser(sql, owner, (tx) => tx`UPDATE sales SET seller_employee_id = ${ana} WHERE id = ${venta}`);
    expect(directo.count).toBe(0);
    expect(await vendedorDe(venta)).toBe(empleadoStaff);

    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ana}, 'Se equivocó')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ana}, ' ')`),
    ).rejects.toThrow(/motivo/);
    const [ajenoEmp] = await sql<{ id: string }[]>`
      INSERT INTO hr_employees (business_id, display_name) VALUES (${otroNegocio}, 'De otra tienda') RETURNING id`;
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ajenoEmp.id}, 'Prueba')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ana}, 'Prueba')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    await asUser(sql, admin, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ana}, 'La atendió Ana')`);
    expect(await vendedorDe(venta)).toBe(ana);
    const cambios = await asUser(sql, admin, (tx) => tx`
      SELECT from_employee_id, to_employee_id, changed_by, reason FROM sale_seller_changes WHERE sale_id = ${venta}`);
    expect(cambios).toEqual([{ from_employee_id: empleadoStaff, to_employee_id: ana, changed_by: admin, reason: 'La atendió Ana' }]);
    // El staff no ve el historial de cambios ni puede escribirlo.
    await expect(asUser(sql, staff, (tx) => tx`SELECT * FROM sale_seller_changes`)).resolves.toHaveLength(0);
    await expect(
      asUser(sql, admin, (tx) => tx`INSERT INTO sale_seller_changes (business_id, sale_id, changed_by, reason) VALUES (${negocio}, ${venta}, ${admin}, 'x')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Reasignar a la misma persona no deja rastro.
    await asUser(sql, admin, (tx) => tx`SELECT public.reassign_sale_seller(${venta}, ${ana}, 'Repetido')`);
    expect(await asUser(sql, admin, (tx) => tx`SELECT id FROM sale_seller_changes WHERE sale_id = ${venta}`)).toHaveLength(1);
  });

  it('el informe por vendedor cuadra ventas y devoluciones y es solo del propietario', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const filas = await asUser(sql, owner, (tx) => tx`
      SELECT * FROM public.get_sales_by_seller(${negocio}, ${hoy}::date, ${hoy}::date)`);
    const esperado = await sql`
      SELECT s.seller_employee_id AS emp, count(*)::int AS n, sum(s.total) AS t FROM sales s WHERE s.business_id = ${negocio} GROUP BY 1`;
    for (const e of esperado) {
      const fila = filas.find((f) => f.employee_id === e.emp);
      expect(fila, `vendedor ${e.emp}`).toBeDefined();
      expect(fila!.sales_count).toBe(e.n);
      expect(Number(fila!.sales_total)).toBe(Number(e.t));
      expect(fila!.name).toBe(e.emp === null ? 'Sin vendedor' : e.emp === ana ? 'Ana López' : fila!.name);
    }
    const deAna = filas.find((f) => f.employee_id === ana)!;
    expect(deAna.returns_count).toBe(1);
    expect(Number(deAna.net_total)).toBe(r2(Number(deAna.sales_total) - Number(deAna.returns_total)));

    for (const user of [admin, staff, ajeno]) {
      await expect(
        asUser(sql, user, (tx) => tx`SELECT * FROM public.get_sales_by_seller(${negocio}, ${hoy}::date, ${hoy}::date)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    }
  });

  it('cada uno cambia su PIN con el actual; los fallos cuentan para el bloqueo', async () => {
    const cambiar = async (actual: string, nuevo: string, user = staff) => {
      const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; error: string | null; locked_seconds: number }[]>`
        SELECT * FROM public.change_own_pin(${negocio}, ${ana}, ${actual}, ${nuevo})`);
      return r;
    };
    const abierta = (await empezar(staff, ana, '1234')).session_id!;
    expect(await cambiar('9999', '4321')).toMatchObject({ ok: false, error: 'PIN incorrecto' });
    await expect(cambiar('1234', '12')).rejects.toThrow(/4 y 6 cifras/);
    await expect(cambiar('1234', '4321', ajeno)).rejects.toMatchObject(PERMISO_DENEGADO);
    expect(await cambiar('1234', '4321')).toMatchObject({ ok: true, error: null });
    // El PIN viejo deja de valer, el nuevo sí, y la sesión que estaba abierta se cierra.
    expect((await empezar(staff, ana, '1234')).ok).toBe(false);
    await expect(vender(staff, abierta)).rejects.toThrow(/sesión de vendedor/i);
    expect((await empezar(staff, ana, '4321')).ok).toBe(true);
    // Los fallos al cambiarlo bloquean igual que al identificarse.
    for (let i = 0; i < 4; i++) await cambiar('0000', '5555');
    expect((await cambiar('0000', '5555')).locked_seconds).toBeGreaterThan(0);
    expect((await empezar(staff, ana, '4321')).error).toMatch(/Demasiados intentos/);
    await sql`UPDATE hr_employee_pins SET locked_until = NULL WHERE employee_id = ${ana}`;
  });
});
