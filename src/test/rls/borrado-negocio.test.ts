// @vitest-environment node
// Borrado de negocios con los triggers de auditoría activos (A14 de docs/AUDITORIA.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

describe.skipIf(!RLS_DB_URL)('RLS · borrado de negocios', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let admin: string;
  let staff: string;

  const crearNegocioConDatos = async (nombre: string) => {
    const [row] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
    const id = row.id;
    await sql`INSERT INTO clients (business_id, name) VALUES (${id}, 'Cliente')`;
    await sql`INSERT INTO products (business_id, name, price) VALUES (${id}, 'Zueco', 99)`;
    await sql`INSERT INTO invoices (business_id, invoice_number) VALUES (${id}, 'FAC-000001')`;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${id}, ${admin}, 'admin', true), (${id}, ${staff}, 'staff', true)`;
    return id;
  };

  const cuenta = async (tabla: string, businessId: string) => {
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${tabla} WHERE business_id = $1`, [businessId]);
    return r.n as number;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el owner borra su negocio y se van en cascada todos sus datos', async () => {
    const id = await crearNegocioConDatos('Para borrar');

    const borrados = await asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${id}`);
    expect(borrados.count).toBe(1);

    const [negocio] = await sql`SELECT count(*)::int AS n FROM businesses WHERE id = ${id}`;
    expect(negocio.n).toBe(0);
    for (const tabla of ['business_members', 'clients', 'products', 'invoices', 'subscriptions', 'business_modules', 'business_settings']) {
      expect(await cuenta(tabla, id), tabla).toBe(0);
    }
  });

  it('la auditoría conserva el borrado con el id del negocio en old_data', async () => {
    const id = await crearNegocioConDatos('Auditado');
    await asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${id}`);

    const [fila] = await sql`
      SELECT business_id, record_id, old_data->>'name' AS nombre FROM audit_logs
      WHERE table_name = 'businesses' AND action = 'DELETE' AND old_data->>'id' = ${id}`;
    expect(fila).toEqual({ business_id: null, record_id: id, nombre: 'Auditado' });

    const [miembros] = await sql`
      SELECT count(*)::int AS n FROM audit_logs
      WHERE table_name = 'business_members' AND action = 'DELETE' AND old_data->>'business_id' = ${id}`;
    expect(miembros.n).toBe(3);
  });

  it('admin y staff no pueden borrar el negocio; el super admin sí', async () => {
    const id = await crearNegocioConDatos('Protegido');

    for (const usuario of [admin, staff]) {
      const r = await asUser(sql, usuario, (tx) => tx`DELETE FROM businesses WHERE id = ${id}`);
      expect(r.count).toBe(0);
    }

    const superAdmin = await createUser(sql, 'super-borrado@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
    const r = await asUser(sql, superAdmin, (tx) => tx`DELETE FROM businesses WHERE id = ${id}`);
    expect(r.count).toBe(1);
  });
});
