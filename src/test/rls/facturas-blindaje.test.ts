// @vitest-environment node
// Facturas y cobros blindados (0050): lectura solo de administradores, nada de borrar ni
// editar a mano (tampoco el super admin), estado y cobros solo por RPC.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const VALOR_INVALIDO = { code: '22023' };

type Linea = { description: string; quantity: number; unit_price: number; product_id?: string };

describe.skipIf(!RLS_DB_URL)('RLS · facturas y cobros blindados', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let admin: string;
  let staff: string;
  let superAdmin: string;
  let negocio: string;
  let otroNegocio: string;
  let productoAjeno: string;

  const facturar = async (user: string, items: Linea[], dueDate: string | null = null, business = negocio) => {
    const [f] = await asUser(sql, user, (tx) => tx<{ invoice_id: string; invoice_number: string }[]>`
      SELECT * FROM public.create_invoice_with_items(_business_id => ${business}, _client_id => NULL,
        _items => ${sql.json(items)}::jsonb, _due_date => ${dueDate}::date, _notes => NULL)`);
    return f.invoice_id;
  };

  const estado = (user: string, factura: string, nuevo: string) =>
    asUser(sql, user, (tx) => tx<{ s: string }[]>`
      SELECT public.set_invoice_status(${negocio}, ${factura}, ${nuevo}::invoice_status) AS s`).then((r) => r[0].s);

  const cobrar = (user: string, factura: string, importe: number) =>
    asUser(sql, user, (tx) => tx<{ id: string }[]>`
      SELECT public.create_payment_and_recalc_invoice(${negocio}, ${factura}, ${importe}) AS id`).then((r) => r[0].id);

  const anularCobro = (user: string, cobro: string) =>
    asUser(sql, user, (tx) => tx`SELECT public.delete_payment_and_recalc_invoice(${negocio}, ${cobro})`);

  const factura = async (id: string) => {
    const [f] = await sql<{ status: string; paid: boolean }[]>`
      SELECT status::text, paid_at IS NOT NULL AS paid FROM invoices WHERE id = ${id}`;
    return f;
  };

  const linea: Linea[] = [{ description: 'Arreglo', quantity: 1, unit_price: 100 }];

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    const [o] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = o.id;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price) VALUES (${otroNegocio}, 'Ajeno', 10) RETURNING id`;
    productoAjeno = p.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('lectura: el personal no ve facturas, líneas ni cobros; administrador y super admin sí', async () => {
    const f = await facturar(admin, linea);
    await estado(admin, f, 'sent');
    await cobrar(admin, f, 10);

    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM invoices WHERE id = ${f}`)).toHaveLength(0);
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM invoice_items WHERE invoice_id = ${f}`)).toHaveLength(0);
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM payments WHERE invoice_id = ${f}`)).toHaveLength(0);
    for (const user of [owner, admin, superAdmin]) {
      expect(await asUser(sql, user, (tx) => tx`SELECT id FROM invoices WHERE id = ${f}`)).toHaveLength(1);
      expect(await asUser(sql, user, (tx) => tx`SELECT id FROM invoice_items WHERE invoice_id = ${f}`)).toHaveLength(1);
      expect(await asUser(sql, user, (tx) => tx`SELECT id FROM payments WHERE invoice_id = ${f}`)).toHaveLength(1);
    }
  });

  it('nadie borra ni edita a mano facturas, líneas ni cobros, tampoco el super admin', async () => {
    const f = await facturar(admin, linea);
    await estado(admin, f, 'sent');
    const cobro = await cobrar(admin, f, 10);

    for (const user of [owner, admin, superAdmin]) {
      await expect(asUser(sql, user, (tx) => tx`UPDATE invoices SET status = 'paid' WHERE id = ${f}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`UPDATE invoices SET total = 1 WHERE id = ${f}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM invoices WHERE id = ${f}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`UPDATE invoice_items SET total = 1 WHERE invoice_id = ${f}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM invoice_items WHERE invoice_id = ${f}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(
        asUser(sql, user, (tx) => tx`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total) VALUES (${f}, 'x', 1, 1, 1)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`UPDATE payments SET amount = 1 WHERE id = ${cobro}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM payments WHERE id = ${cobro}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(
        asUser(sql, user, (tx) => tx`INSERT INTO payments (business_id, invoice_id, amount) VALUES (${negocio}, ${f}, 10)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    const [n] = await sql`SELECT count(*)::int AS n FROM payments WHERE invoice_id = ${f}`;
    expect(n.n).toBe(1);
    expect((await factura(f)).status).toBe('sent');
  });

  it('estado: solo emitir y anular; pagada y vencida salen de los cobros', async () => {
    const f = await facturar(admin, linea);
    await expect(estado(staff, f, 'sent')).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(estado(admin, f, 'paid')).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(estado(admin, f, 'overdue')).rejects.toMatchObject(VALOR_INVALIDO);

    expect(await estado(admin, f, 'sent')).toBe('sent');
    await expect(estado(admin, f, 'draft')).rejects.toMatchObject(VALOR_INVALIDO);
    expect(await estado(owner, f, 'cancelled')).toBe('cancelled');
    await expect(estado(admin, f, 'sent')).rejects.toMatchObject(VALOR_INVALIDO);

    // Un borrador también se anula, y conserva su número.
    const b = await facturar(admin, linea);
    expect(await estado(admin, b, 'cancelled')).toBe('cancelled');
    const [num] = await sql`SELECT invoice_number FROM invoices WHERE id = ${b}`;
    expect(num.invoice_number).toMatch(/^FAC-\d{6}$/);

    // Con la fecha de vencimiento pasada, al emitirla queda vencida.
    const v = await facturar(admin, linea, '2020-01-01');
    expect(await estado(admin, v, 'sent')).toBe('overdue');

    // De otro negocio, no.
    const ajena = await facturar(owner, linea, null, otroNegocio);
    await expect(estado(admin, ajena, 'sent')).rejects.toMatchObject(VALOR_INVALIDO);
  });

  it('no se anula una factura con cobros', async () => {
    const f = await facturar(admin, linea);
    await estado(admin, f, 'sent');
    const cobro = await cobrar(admin, f, 30);
    await expect(estado(admin, f, 'cancelled')).rejects.toMatchObject(VALOR_INVALIDO);
    await anularCobro(admin, cobro);
    expect(await estado(admin, f, 'cancelled')).toBe('cancelled');
  });

  it('cobros: no se cobra de más, el último la deja pagada y anularlo la reabre', async () => {
    const f = await facturar(admin, linea);
    await expect(cobrar(admin, f, 10)).rejects.toMatchObject(VALOR_INVALIDO); // borrador
    await estado(admin, f, 'sent');
    await expect(cobrar(admin, f, 100.01)).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(cobrar(admin, f, 0)).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(cobrar(staff, f, 10)).rejects.toMatchObject(PERMISO_DENEGADO);

    await cobrar(admin, f, 40);
    expect(await factura(f)).toEqual({ status: 'sent', paid: false });
    const ultimo = await cobrar(admin, f, 60);
    expect(await factura(f)).toEqual({ status: 'paid', paid: true });
    await expect(cobrar(admin, f, 0.01)).rejects.toMatchObject(VALOR_INVALIDO);

    await expect(anularCobro(staff, ultimo)).rejects.toMatchObject(PERMISO_DENEGADO);
    await anularCobro(admin, ultimo);
    expect(await factura(f)).toEqual({ status: 'sent', paid: false });
    const [n] = await sql`SELECT count(*)::int AS n FROM payments WHERE invoice_id = ${f}`;
    expect(n.n).toBe(1);
    const [log] = await sql`SELECT count(*)::int AS n FROM audit_logs WHERE record_id = ${ultimo} AND action = 'DELETE'`;
    expect(log.n).toBe(1);

    // Vencida: al anular el cobro que la pagaba vuelve a vencida.
    const v = await facturar(admin, linea, '2020-01-01');
    await estado(admin, v, 'sent');
    const total = await cobrar(admin, v, 100);
    expect((await factura(v)).status).toBe('paid');
    await anularCobro(admin, total);
    expect(await factura(v)).toEqual({ status: 'overdue', paid: false });

    // Un cobro de otro negocio no se encuentra.
    const ajena = await facturar(owner, linea, null, otroNegocio);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_invoice_status(${otroNegocio}, ${ajena}, 'sent')`);
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`
      SELECT public.create_payment_and_recalc_invoice(${otroNegocio}, ${ajena}, 5) AS id`);
    await expect(anularCobro(admin, c.id)).rejects.toMatchObject(VALOR_INVALIDO);
  });

  it('crear factura: líneas válidas y productos del negocio', async () => {
    await expect(facturar(admin, [{ ...linea[0], product_id: productoAjeno }])).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(facturar(admin, [{ ...linea[0], quantity: 0 }])).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(facturar(admin, [{ ...linea[0], quantity: -1 }])).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(facturar(admin, [{ ...linea[0], unit_price: -5 }])).rejects.toMatchObject(VALOR_INVALIDO);
    await expect(facturar(admin, [{ ...linea[0], description: '  ' }])).rejects.toMatchObject(VALOR_INVALIDO);

    const [p] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Propio', 10) RETURNING id`;
    const f = await facturar(admin, [{ description: 'Propio', quantity: 2, unit_price: 10, product_id: p.id }]);
    const [inv] = await sql`SELECT total::float FROM invoices WHERE id = ${f}`;
    expect(inv.total).toBe(20);
  });

  it('borrar el negocio sigue borrando sus facturas, líneas y cobros', async () => {
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Para borrar', null) AS id`);
    const [f] = await asUser(sql, owner, (tx) => tx<{ invoice_id: string }[]>`
      SELECT * FROM public.create_invoice_with_items(_business_id => ${b.id}, _client_id => NULL,
        _items => ${sql.json(linea)}::jsonb, _due_date => NULL, _notes => NULL)`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_invoice_status(${b.id}, ${f.invoice_id}, 'sent')`);
    await asUser(sql, owner, (tx) => tx`SELECT public.create_payment_and_recalc_invoice(${b.id}, ${f.invoice_id}, 10)`);

    const borrados = await asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${b.id}`);
    expect(borrados.count).toBe(1);
    const [r] = await sql`
      SELECT (SELECT count(*)::int FROM invoices WHERE business_id = ${b.id}) AS facturas,
             (SELECT count(*)::int FROM invoice_items WHERE invoice_id = ${f.invoice_id}) AS lineas,
             (SELECT count(*)::int FROM payments WHERE business_id = ${b.id}) AS cobros`;
    expect(r).toEqual({ facturas: 0, lineas: 0, cobros: 0 });
  });
});
