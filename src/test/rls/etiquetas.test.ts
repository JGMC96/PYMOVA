// @vitest-environment node
// Etiquetas (0042): diseños de etiqueta por negocio. Los ven los miembros (para imprimir) y
// los cambian quienes pueden ajustar stock; un solo diseño por defecto por negocio. Y el
// color del producto, que escribe la sincronización con Shopify.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const CONFIG = { version: 1, sheet: { mode: 'sheet' }, fields: [] };

describe.skipIf(!RLS_DB_URL)('RLS · diseños de etiqueta', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otro: string;
  let owner: string;
  let staff: string;
  let gestor: string;
  let ajeno: string;

  const crear = (user: string, name: string, isDefault = false, business = negocio) =>
    asUser(sql, user, (tx) => tx<{ id: string }[]>`
      INSERT INTO label_templates (business_id, name, config, is_default)
      VALUES (${business}, ${name}, ${sql.json(CONFIG)}, ${isDefault}) RETURNING id`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    gestor = await createUser(sql, 'gestor@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otro = o.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${staff}, 'staff', true), (${negocio}, ${gestor}, 'staff', true)`;
    const [eg] = await asUser(sql, gestor, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${eg.id}, 10, false, false, false, false, true)`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('quien puede ajustar stock crea, cambia y borra diseños; el resto solo los ve', async () => {
    const [d] = await crear(gestor, 'Etiquetas OK', true);
    await expect(crear(staff, 'De staff')).rejects.toMatchObject(PERMISO_DENEGADO);
    const vistos = await asUser(sql, staff, (tx) => tx`SELECT name, is_default FROM label_templates`);
    expect(vistos).toEqual([{ name: 'Etiquetas OK', is_default: true }]);
    // El personal sin permiso no cambia ni borra (la RLS no le deja ver la fila para escribir).
    expect(await asUser(sql, staff, (tx) => tx`UPDATE label_templates SET name = 'X' WHERE id = ${d.id} RETURNING id`)).toEqual([]);
    expect(await asUser(sql, staff, (tx) => tx`DELETE FROM label_templates WHERE id = ${d.id} RETURNING id`)).toEqual([]);
    expect(await asUser(sql, gestor, (tx) => tx`UPDATE label_templates SET name = 'Hoja A4' WHERE id = ${d.id} RETURNING name`))
      .toEqual([{ name: 'Hoja A4' }]);
    await crear(owner, 'Rollo 50x30');
  });

  it('un solo diseño por defecto, nombres sin repetir y configuración válida', async () => {
    await expect(crear(owner, 'Otro por defecto', true)).rejects.toThrow(/label_templates_default_key/);
    await expect(crear(owner, '  hoja a4 ')).rejects.toThrow(/label_templates_name_key/);
    await expect(
      asUser(sql, owner, (tx) => tx`INSERT INTO label_templates (business_id, name, config) VALUES (${negocio}, 'Mal', '[]'::jsonb)`),
    ).rejects.toThrow(/check/i);
  });

  it('cada negocio ve y escribe solo los suyos', async () => {
    expect(await asUser(sql, ajeno, (tx) => tx`SELECT id FROM label_templates WHERE business_id = ${negocio}`)).toEqual([]);
    await expect(crear(ajeno, 'Intruso', false, negocio)).rejects.toMatchObject(PERMISO_DENEGADO);
    await crear(ajeno, 'Suya', true, otro);
    expect((await asUser(sql, owner, (tx) => tx`SELECT id FROM label_templates WHERE business_id = ${otro}`))).toEqual([]);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM label_templates`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('el producto tiene color', async () => {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, color) VALUES (${negocio}, 'Zueco Bolonia Piel Negro', 89, 'Piel Negro') RETURNING id`;
    const [r] = await asUser(sql, staff, (tx) => tx`SELECT color FROM products WHERE id = ${p.id}`);
    expect(r.color).toBe('Piel Negro');
  });
});
