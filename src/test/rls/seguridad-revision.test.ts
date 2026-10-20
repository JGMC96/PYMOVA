// @vitest-environment node
// Revisión de seguridad del 20/10/2026: invitaciones que no se pueden reutilizar,
// devoluciones sin líneas repetidas, ajustes sin borrar ni recrear, y la 0022
// (los empleados no se aprueban sus propias ausencias ni permisos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · fallos de la revisión de seguridad', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let staff: string;

  const miembro = async (email: string, role: 'admin' | 'staff') => {
    const user = await createUser(sql, email);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${user}, ${role}, true)`;
    return user;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Victima', null) AS id`);
    negocio = b.id;
    admin = await miembro('admin@ejemplo.test', 'admin');
    staff = await miembro('staff@ejemplo.test', 'staff');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe('invitaciones', () => {
    it('un admin no puede llevar una invitación owner de su negocio al de otro', async () => {
      const alt = await createUser(sql, 'alt@ejemplo.test');
      const [propio] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Propio', null) AS id`);
      const [inv] = await asUser(sql, admin, (tx) => tx<{ id: string; token: string }[]>`
        INSERT INTO business_invitations (business_id, email, role, invited_by)
        VALUES (${propio.id}, 'alt@ejemplo.test', 'owner', ${admin}) RETURNING id, token`);

      await expect(
        asUser(sql, admin, (tx) => tx`
          UPDATE business_invitations SET business_id = ${negocio}, invited_by = ${owner} WHERE id = ${inv.id}`),
      ).rejects.toThrow(/solo se puede revocar/i);

      const [sigue] = await sql`SELECT business_id FROM business_invitations WHERE id = ${inv.id}`;
      expect(sigue.business_id).toBe(propio.id);
      const [n] = await sql`SELECT count(*)::int AS n FROM business_members WHERE business_id = ${negocio} AND user_id = ${alt}`;
      expect(n.n).toBe(0);
    });

    it('revocar sigue funcionando, pero no se reactiva ni se cambia el correo', async () => {
      const [inv] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
        INSERT INTO business_invitations (business_id, email, role, invited_by)
        VALUES (${negocio}, 'nueva@ejemplo.test', 'staff', ${admin}) RETURNING id`);

      await expect(
        asUser(sql, admin, (tx) => tx`UPDATE business_invitations SET email = 'otra@ejemplo.test' WHERE id = ${inv.id}`),
      ).rejects.toThrow(/solo se puede revocar/i);

      const revocada = await asUser(sql, admin, (tx) => tx`UPDATE business_invitations SET status = 'revoked' WHERE id = ${inv.id}`);
      expect(revocada.count).toBe(1);

      await expect(
        asUser(sql, admin, (tx) => tx`UPDATE business_invitations SET status = 'pending' WHERE id = ${inv.id}`),
      ).rejects.toThrow(/solo se puede revocar/i);
    });

    it('una invitación legítima se sigue aceptando', async () => {
      const invitado = await createUser(sql, 'legitimo@ejemplo.test');
      const [inv] = await asUser(sql, owner, (tx) => tx<{ token: string }[]>`
        INSERT INTO business_invitations (business_id, email, role, invited_by)
        VALUES (${negocio}, 'legitimo@ejemplo.test', 'staff', ${owner}) RETURNING token`);
      await asUser(sql, invitado, (tx) => tx`SELECT public.accept_business_invitation(${inv.token})`);
      const [m] = await sql`SELECT role FROM business_members WHERE business_id = ${negocio} AND user_id = ${invitado}`;
      expect(m.role).toBe('staff');
      const [i] = await sql`SELECT status FROM business_invitations WHERE token = ${inv.token}`;
      expect(i.status).toBe('accepted');
    });
  });

  it('devoluciones: la misma línea dos veces se rechaza y no cambia el stock', async () => {
    await asUser(sql, owner, (tx) => tx`SELECT public.open_register_session(${negocio}, 0)`);
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
      VALUES (${negocio}, 'Zueco', 100, 10, true) RETURNING id`;
    const items = [{ product_id: p.id, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, total: 100 }];
    const [venta] = await asUser(sql, staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => 82.64, _tax => 17.36, _total => 100)`);
    const [linea] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta.sale_id}`;

    const devolver = (lineas: { sale_item_id: string; quantity: number }[]) =>
      asUser(sql, staff, (tx) => tx`
        SELECT * FROM public.create_sale_return(${negocio}, ${venta.sale_id}, ${sql.json(lineas)}::jsonb, 'Talla', 'cash', true)`);

    await expect(
      devolver([{ sale_item_id: linea.id, quantity: 1 }, { sale_item_id: linea.id, quantity: 1 }]),
    ).rejects.toThrow(/una vez/i);
    const [stock] = await sql`SELECT stock_quantity FROM products WHERE id = ${p.id}`;
    expect(stock.stock_quantity).toBe(9);
    const [n] = await sql`SELECT count(*)::int AS n FROM sale_returns WHERE sale_id = ${venta.sale_id}`;
    expect(n.n).toBe(0);

    await devolver([{ sale_item_id: linea.id, quantity: 1 }]);
    const [d] = await sql`SELECT total::float FROM sale_returns WHERE sale_id = ${venta.sale_id}`;
    expect(d.total).toBe(100);
  });

  it('ajustes: un admin no puede borrar ni recrear la fila; sí cambiar prefijo e IVA', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`DELETE FROM business_settings WHERE business_id = ${negocio}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`INSERT INTO business_settings (business_id, next_invoice_number) VALUES (${negocio}, 5000)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const ok = await asUser(sql, admin, (tx) => tx`
      UPDATE business_settings SET invoice_prefix = 'T-', tax_rate = 10 WHERE business_id = ${negocio}`);
    expect(ok.count).toBe(1);
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE business_settings SET next_invoice_number = 5000 WHERE business_id = ${negocio}`),
    ).rejects.toThrow(/contadores/i);
    const nada = await asUser(sql, staff, (tx) => tx`UPDATE business_settings SET invoice_prefix = 'X-' WHERE business_id = ${negocio}`);
    expect(nada.count).toBe(0);
  });

  describe('0022 · ausencias y permisos sin autoaprobación', () => {
    it('ausencias: el empleado pide y cancela, pero no se aprueba; el admin aprueba', async () => {
      const [pedida] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`
        SELECT public.request_absence(${negocio}, 'vacation', '2026-11-02', '2026-11-06') AS id`);
      const [emp] = await sql`SELECT employee_id FROM hr_absences WHERE id = ${pedida.id}`;

      await expect(
        asUser(sql, staff, (tx) => tx`
          INSERT INTO hr_absences (business_id, employee_id, absence_type, status, start_date, end_date, days_count)
          VALUES (${negocio}, ${emp.employee_id}, 'vacation', 'approved', '2026-12-01', '2026-12-05', 5)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(
        asUser(sql, staff, (tx) => tx`UPDATE hr_absences SET status = 'approved' WHERE id = ${pedida.id}`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);

      await asUser(sql, admin, (tx) => tx`SELECT public.review_absence(${pedida.id}, true)`);
      const [aprobada] = await sql`SELECT status FROM hr_absences WHERE id = ${pedida.id}`;
      expect(aprobada.status).toBe('approved');

      const [otra] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`
        SELECT public.request_absence(${negocio}, 'personal', '2026-11-20', '2026-11-20') AS id`);
      const cancelada = await asUser(sql, staff, (tx) => tx`UPDATE hr_absences SET status = 'cancelled' WHERE id = ${otra.id}`);
      expect(cancelada.count).toBe(1);
    });

    it('permisos: el empleado pide y cancela, pero no se aprueba; el admin aprueba', async () => {
      const [pedido] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`
        SELECT public.request_permission(${negocio}, 'late_arrival', '2026-11-03', '09:00', '10:00') AS id`);
      const [emp] = await sql`SELECT employee_id FROM hr_permissions WHERE id = ${pedido.id}`;

      await expect(
        asUser(sql, staff, (tx) => tx`
          INSERT INTO hr_permissions (business_id, employee_id, permission_type, status, permission_date, start_time, end_time, hours_count)
          VALUES (${negocio}, ${emp.employee_id}, 'late_arrival', 'approved', '2026-12-01', '09:00', '13:00', 4)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(
        asUser(sql, staff, (tx) => tx`UPDATE hr_permissions SET status = 'approved' WHERE id = ${pedido.id}`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);

      await asUser(sql, admin, (tx) => tx`SELECT public.review_permission(${pedido.id}, true)`);
      const [aprobado] = await sql`SELECT status FROM hr_permissions WHERE id = ${pedido.id}`;
      expect(aprobado.status).toBe('approved');

      const [otro] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`
        SELECT public.request_permission(${negocio}, 'early_departure', '2026-11-04', '18:00', '20:00') AS id`);
      const cancelado = await asUser(sql, staff, (tx) => tx`UPDATE hr_permissions SET status = 'cancelled' WHERE id = ${otro.id}`);
      expect(cancelado.count).toBe(1);
    });
  });
});
