// @vitest-environment node
// A8 (invitaciones como owner) y A7 (numeración correlativa) de docs/AUDITORIA.md.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Negocio { id: string; owner: string; producto: string; variante: string }

async function crearNegocio(sql: Sql, ownerEmail: string, nombre: string): Promise<Negocio> {
  const owner = await createUser(sql, ownerEmail);
  const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${b.id}, 'Zueco', 10, 1000, true) RETURNING id`;
  const [v] = await sql<{ id: string }[]>`
    INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${b.id}, ${p.id}, 'T38', 10, 1000) RETURNING id`;
  // Las ventas y devoluciones en efectivo necesitan una caja abierta (M2).
  await asUser(sql, owner, (tx) => tx`SELECT public.open_register_session(${b.id}, 0)`);
  return { id: b.id, owner, producto: p.id, variante: v.id };
}

/** Venta de 1 unidad a 10 € con IVA incluido (21 %): total 10, base 8,26, IVA 1,74. */
function vender(sql: Sql, n: Negocio, userId = n.owner) {
  const items = [{ product_id: n.producto, variant_id: n.variante, product_name: 'Zueco · T38', quantity: 1, unit_price: 10, total: 10 }];
  const base = r2(10 / (1 + IVA / 100));
  return asUser(sql, userId, (tx) => tx<{ sale_id: string; sale_number: string }[]>`
    SELECT * FROM public.create_sale_with_items(
      _business_id => ${n.id}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
      _subtotal => ${base}, _tax => ${r2(10 - base)}, _total => 10, _discount => 0)`);
}

describe.skipIf(!RLS_DB_URL)('RLS · invitaciones como owner y numeración correlativa', () => {
  let db: TestDb;
  let sql: Sql;
  let A: Negocio;
  let admin: string;
  let superAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    A = await crearNegocio(sql, 'owner@ejemplo.test', 'Tienda');
    admin = await createUser(sql, 'admin@ejemplo.test');
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${A.id}, ${admin}, 'admin', true)`;
    superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('A8: un admin no puede invitar como owner ni convertir una invitación en owner; el owner sí', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`
        INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${A.id}, 'x@ejemplo.test', 'owner', ${admin})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const [inv] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
      INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${A.id}, 'y@ejemplo.test', 'staff', ${admin}) RETURNING id`);
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE business_invitations SET role = 'owner' WHERE id = ${inv.id}`),
    ).rejects.toThrow(/propietario/i);
    const revocada = await asUser(sql, admin, (tx) => tx`UPDATE business_invitations SET status = 'revoked' WHERE id = ${inv.id}`);
    expect(revocada.count).toBe(1);
    const [sigue] = await sql`SELECT role FROM business_invitations WHERE id = ${inv.id}`;
    expect(sigue.role).toBe('staff');

    const [porOwner] = await asUser(sql, A.owner, (tx) => tx<{ id: string }[]>`
      INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${A.id}, 'z@ejemplo.test', 'owner', ${A.owner}) RETURNING id`);
    expect(porOwner.id).toBeTruthy();
  });

  it('A8: una invitación owner creada por un admin (anterior a la migración) no se puede aceptar', async () => {
    const invitado = await createUser(sql, 'colado@ejemplo.test');
    const [inv] = await sql<{ token: string }[]>`
      INSERT INTO business_invitations (business_id, email, role, invited_by) VALUES (${A.id}, 'colado@ejemplo.test', 'owner', ${admin}) RETURNING token`;
    await expect(
      asUser(sql, invitado, (tx) => tx`SELECT public.accept_business_invitation(${inv.token})`),
    ).rejects.toThrow(/no es válida/i);
    const [m] = await sql`SELECT count(*)::int AS n FROM business_members WHERE business_id = ${A.id} AND user_id = ${invitado}`;
    expect(m.n).toBe(0);
  });

  it('A7: 20 ventas simultáneas reciben números distintos y consecutivos', async () => {
    const ventas = await Promise.all(Array.from({ length: 20 }, () => vender(sql, A)));
    const numeros = ventas.map(([v]) => v.sale_number).sort();
    expect(new Set(numeros).size).toBe(20);
    expect(numeros[0]).toBe('VTA-000001');
    expect(numeros[19]).toBe('VTA-000020');
  }, 30_000);

  it('A7: 10 devoluciones simultáneas reciben números distintos y consecutivos', async () => {
    const ventas = await sql`SELECT id FROM sales WHERE business_id = ${A.id} ORDER BY sale_number LIMIT 10`;
    const devs = await Promise.all(
      ventas.map(async (v) => {
        const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${v.id}`;
        return asUser(sql, A.owner, (tx) => tx<{ return_number: string }[]>`
          SELECT * FROM public.create_sale_return(${A.id}, ${v.id}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, 'Prueba', 'cash', true)`);
      }),
    );
    const numeros = devs.map(([d]) => d.return_number).sort();
    expect(new Set(numeros).size).toBe(10);
    expect(numeros[0]).toBe('DEV-000001');
    expect(numeros[9]).toBe('DEV-000010');
  }, 30_000);

  it('A7: 10 números de pedido online simultáneos son distintos; anon y no miembros no pueden pedirlos', async () => {
    const nums = await Promise.all(
      Array.from({ length: 10 }, () => asUser(sql, A.owner, (tx) => tx<{ n: string }[]>`SELECT public.generate_online_order_number(${A.id}) AS n`)),
    );
    const lista = nums.map(([r]) => r.n).sort();
    expect(new Set(lista).size).toBe(10);
    expect(lista[0]).toBe('WEB-000001');

    const ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT public.generate_online_order_number(${A.id})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT public.generate_online_order_number(${A.id})`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('A7: los contadores y los números de documento no se pueden editar; las facturas solo por RPC', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE business_settings SET next_invoice_number = 999 WHERE business_id = ${A.id}`),
    ).rejects.toThrow(/contadores/i);
    const prefijo = await asUser(sql, admin, (tx) => tx`UPDATE business_settings SET invoice_prefix = 'T-' WHERE business_id = ${A.id}`);
    expect(prefijo.count).toBe(1);

    await expect(sql`UPDATE sales SET sale_number = 'VTA-999999' WHERE business_id = ${A.id} AND sale_number = 'VTA-000001'`).rejects.toThrow(/número/i);

    await expect(
      asUser(sql, A.owner, (tx) => tx`INSERT INTO invoices (business_id, invoice_number) VALUES (${A.id}, 'T-000099')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const items = [{ description: 'Servicio', quantity: 1, unit_price: 100 }];
    const [f1] = await asUser(sql, A.owner, (tx) => tx<{ invoice_number: string }[]>`
      SELECT * FROM public.create_invoice_with_items(_business_id => ${A.id}, _client_id => NULL, _items => ${sql.json(items)}::jsonb, _due_date => NULL, _notes => NULL)`);
    const [f2] = await asUser(sql, A.owner, (tx) => tx<{ invoice_number: string }[]>`
      SELECT * FROM public.create_invoice_with_items(_business_id => ${A.id}, _client_id => NULL, _items => ${sql.json(items)}::jsonb, _due_date => NULL, _notes => NULL)`);
    expect([f1.invoice_number, f2.invoice_number]).toEqual(['T-000001', 'T-000002']);
  });

  it('A7: el índice único rechaza un número de venta repetido', async () => {
    const [v] = await sql`SELECT * FROM sales WHERE business_id = ${A.id} LIMIT 1`;
    await expect(
      sql`INSERT INTO sales (business_id, sale_number, total) VALUES (${A.id}, ${v.sale_number}, 1)`,
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe.skipIf(!RLS_DB_URL)('RLS · numeración: siembra de contadores con datos previos', () => {
  let db: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    db = await createTestDb({ skip: (f) => f.includes('0018_') });
    sql = db.sql;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('un negocio con ventas previas continúa la serie al aplicar la migración', async () => {
    const A = await crearNegocio(sql, 'previo@ejemplo.test', 'Previa');
    await sql`INSERT INTO sales (business_id, sale_number, total) VALUES (${A.id}, 'VTA-000007', 1), (${A.id}, 'VTA-000003', 1)`;
    await sql`INSERT INTO sale_returns (business_id, sale_id, return_number, total)
      SELECT ${A.id}, id, 'DEV-000002', 0 FROM sales WHERE business_id = ${A.id} LIMIT 1`;

    const ruta = join(resolve(__dirname, '../../..'), 'drizzle/migrations/0018_invitaciones_owner_y_numeracion.sql');
    await sql.unsafe(readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n'));

    const [c] = await sql`SELECT next_sale_number, next_return_number, next_online_order_number FROM business_settings WHERE business_id = ${A.id}`;
    expect(c).toEqual({ next_sale_number: 8, next_return_number: 3, next_online_order_number: 1 });

    const [v] = await vender(sql, A);
    expect(v.sale_number).toBe('VTA-000008');
  });
});
