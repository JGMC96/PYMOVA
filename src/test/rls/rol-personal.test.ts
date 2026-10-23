// @vitest-environment node
// Fase 2B (0031): el rol «personal» solo vende y consulta; precios, costes y stock son
// permisos por persona; clientes, facturas, cobros y el panel de inicio son de
// administradores; cada uno ve solo sus fichajes; un administrador solo gestiona personal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · rol personal y permisos de catálogo', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let admin2: string;
  let staff: string;
  let producto: string;
  let cliente: string;
  let factura: string;
  let empStaff: string;
  let empAdmin: string;

  const permisos = (emp: string, catalogo: boolean, costes: boolean, stock: boolean) =>
    asUser(sql, owner, (tx) => tx`
      SELECT public.set_employee_permissions(${negocio}, ${emp}, 10, false, false, ${catalogo}, ${costes}, ${stock})`);

  const misPermisos = async (user: string) => {
    const [r] = await asUser(sql, user, (tx) => tx<{ can_edit_catalog: boolean; can_see_costs: boolean; can_adjust_stock: boolean }[]>`
      SELECT * FROM public.get_my_permissions(${negocio})`);
    return r;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    admin2 = await createUser(sql, 'admin2@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${admin2}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, cost_price, stock_quantity, track_inventory)
      VALUES (${negocio}, 'Zueco', 100, 40, 5, true) RETURNING id`;
    producto = p.id;
    const [c] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Clienta') RETURNING id`;
    cliente = c.id;
    const items = [{ description: 'Arreglo', quantity: 1, unit_price: 50 }];
    const [f] = await asUser(sql, owner, (tx) => tx<{ invoice_id: string }[]>`
      SELECT * FROM public.create_invoice_with_items(_business_id => ${negocio}, _client_id => ${cliente},
        _items => ${sql.json(items)}::jsonb, _due_date => NULL, _notes => NULL)`);
    factura = f.invoice_id;
    const [es] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empStaff = es.id;
    const [ea] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empAdmin = ea.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('catálogo: el personal no crea ni cambia productos ni precios hasta que el propietario se lo permite', async () => {
    expect(await misPermisos(staff)).toEqual({ can_edit_catalog: false, can_see_costs: false, can_adjust_stock: false });
    expect(await misPermisos(admin)).toEqual({ can_edit_catalog: true, can_see_costs: true, can_adjust_stock: true });
    expect(await misPermisos(owner)).toEqual({ can_edit_catalog: true, can_see_costs: true, can_adjust_stock: true });

    await expect(asUser(sql, staff, (tx) => tx`UPDATE products SET price = 1 WHERE id = ${producto}`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Gratis', 0)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`INSERT INTO product_variants (business_id, product_id, name, price) VALUES (${negocio}, ${producto}, 'T40', 1)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Sigue pudiendo consultar.
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM products WHERE id = ${producto}`)).toHaveLength(1);

    await permisos(empStaff, true, false, false);
    expect((await misPermisos(staff)).can_edit_catalog).toBe(true);
    const ok = await asUser(sql, staff, (tx) => tx`UPDATE products SET price = 110 WHERE id = ${producto}`);
    expect(ok.count).toBe(1);

    // El propietario también puede recortar a un administrador.
    await permisos(empAdmin, false, true, true);
    await expect(asUser(sql, admin, (tx) => tx`UPDATE products SET price = 120 WHERE id = ${producto}`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await permisos(empAdmin, true, true, true);
  });

  it('ajustar stock: permiso por persona', async () => {
    const ajustar = (user: string) =>
      asUser(sql, user, (tx) => tx`SELECT public.adjust_stock(${negocio}, ${producto}, null, 8, 'Recuento')`);
    await permisos(empStaff, false, false, false);
    await expect(ajustar(staff)).rejects.toMatchObject(PERMISO_DENEGADO);
    await permisos(empStaff, false, false, true);
    await ajustar(staff);
    const [p] = await sql`SELECT stock_quantity FROM products WHERE id = ${producto}`;
    expect(p.stock_quantity).toBe(8);
  });

  it('clientes, facturas y cobros: el personal solo consulta', async () => {
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM clients WHERE id = ${cliente}`)).toHaveLength(1);
    await expect(
      asUser(sql, staff, (tx) => tx`INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Nueva')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const upd = await asUser(sql, staff, (tx) => tx`UPDATE clients SET name = 'Otra' WHERE id = ${cliente}`);
    expect(upd.count).toBe(0);
    expect((await asUser(sql, admin, (tx) => tx`UPDATE clients SET name = 'Clienta 2' WHERE id = ${cliente}`)).count).toBe(1);

    const items = [{ description: 'Arreglo', quantity: 1, unit_price: 50 }];
    await expect(
      asUser(sql, staff, (tx) => tx`
        SELECT * FROM public.create_invoice_with_items(_business_id => ${negocio}, _client_id => ${cliente},
          _items => ${sql.json(items)}::jsonb, _due_date => NULL, _notes => NULL)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, staff, (tx) => tx`SELECT public.generate_invoice_number(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    // Desde la 0050 nadie edita facturas a mano: el estado cambia por RPC.
    await expect(asUser(sql, staff, (tx) => tx`UPDATE invoices SET status = 'sent' WHERE id = ${factura}`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total) VALUES (${factura}, 'x', 1, 1, 1)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.set_invoice_status(${negocio}, ${factura}, 'sent')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await asUser(sql, admin, (tx) => tx`SELECT public.set_invoice_status(${negocio}, ${factura}, 'sent')`);

    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.create_payment_and_recalc_invoice(${negocio}, ${factura}, 10)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`INSERT INTO payments (business_id, invoice_id, amount) VALUES (${negocio}, ${factura}, 10)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await asUser(sql, admin, (tx) => tx`SELECT public.create_payment_and_recalc_invoice(${negocio}, ${factura}, 10)`);
  });

  it('el panel de inicio es de administradores', async () => {
    await expect(asUser(sql, staff, (tx) => tx`SELECT * FROM public.get_dashboard_metrics(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, staff, (tx) => tx`SELECT * FROM public.get_recent_activity(${negocio}, 5)`)).rejects.toMatchObject(PERMISO_DENEGADO);
    expect(await asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_dashboard_metrics(${negocio})`)).toHaveLength(1);
  });

  it('RR. HH.: cada uno ve sus fichajes; los administradores, los de todos', async () => {
    await asUser(sql, staff, (tx) => tx`SELECT public.clock_action(${negocio}, 'clock_in')`);
    await asUser(sql, admin, (tx) => tx`SELECT public.clock_action(${negocio}, 'clock_in')`);
    const deStaff = await asUser(sql, staff, (tx) => tx<{ employee_id: string }[]>`SELECT employee_id FROM hr_work_sessions`);
    expect(deStaff.map((r) => r.employee_id)).toEqual([empStaff]);
    const entradas = await asUser(sql, staff, (tx) => tx<{ employee_id: string }[]>`SELECT employee_id FROM hr_time_entries`);
    expect(new Set(entradas.map((r) => r.employee_id))).toEqual(new Set([empStaff]));
    const deAdmin = await asUser(sql, admin, (tx) => tx<{ employee_id: string }[]>`SELECT employee_id FROM hr_work_sessions`);
    expect(new Set(deAdmin.map((r) => r.employee_id))).toEqual(new Set([empStaff, empAdmin]));
  });

  it('equipo: el personal no ve los correos de los demás', async () => {
    const vistaStaff = await asUser(sql, staff, (tx) => tx<{ user_id: string; email: string | null }[]>`
      SELECT user_id, email FROM public.get_business_team(${negocio})`);
    expect(vistaStaff.find((m) => m.user_id === staff)!.email).toBe('staff@ejemplo.test');
    expect(vistaStaff.filter((m) => m.user_id !== staff).every((m) => m.email === null)).toBe(true);
    const vistaAdmin = await asUser(sql, admin, (tx) => tx<{ email: string | null }[]>`SELECT email FROM public.get_business_team(${negocio})`);
    expect(vistaAdmin.every((m) => m.email !== null)).toBe(true);
  });

  it('un administrador solo gestiona personal; no se toca a sí mismo ni a otros administradores', async () => {
    expect((await asUser(sql, admin, (tx) => tx`UPDATE business_members SET is_active = false WHERE business_id = ${negocio} AND user_id = ${admin2}`)).count).toBe(0);
    expect((await asUser(sql, admin, (tx) => tx`UPDATE business_members SET role = 'staff' WHERE business_id = ${negocio} AND user_id = ${admin}`)).count).toBe(0);
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE business_members SET role = 'admin' WHERE business_id = ${negocio} AND user_id = ${staff}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Suspender y reactivar a personal, sí.
    expect((await asUser(sql, admin, (tx) => tx`UPDATE business_members SET is_active = false WHERE business_id = ${negocio} AND user_id = ${staff}`)).count).toBe(1);
    expect((await sql`UPDATE business_members SET is_active = true WHERE business_id = ${negocio} AND user_id = ${staff}`).count).toBe(1);
    // El propietario sí asciende; y nadie cambia la persona de una fila.
    expect((await asUser(sql, owner, (tx) => tx`UPDATE business_members SET role = 'admin' WHERE business_id = ${negocio} AND user_id = ${staff}`)).count).toBe(1);
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE business_members SET user_id = ${admin2} WHERE business_id = ${negocio} AND user_id = ${staff}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await sql`UPDATE business_members SET role = 'staff' WHERE business_id = ${negocio} AND user_id = ${staff}`;

    // Invitaciones: un administrador solo invita a personal.
    await expect(
      asUser(sql, admin, (tx) => tx`
        INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${negocio}, 'jefa@ejemplo.test', 'admin', ${admin})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const ok = await asUser(sql, admin, (tx) => tx`
      INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${negocio}, 'dependienta@ejemplo.test', 'staff', ${admin})`);
    expect(ok.count).toBe(1);
    const deOwner = await asUser(sql, owner, (tx) => tx`
      INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${negocio}, 'jefa@ejemplo.test', 'admin', ${owner})`);
    expect(deOwner.count).toBe(1);
  });
});
