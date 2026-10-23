// @vitest-environment node
// Verificación en dos pasos (0049): con el segundo paso activado, una sesión de solo
// contraseña (aal1) no ve ni toca nada del negocio; con el código (aal2), todo igual que antes.
// Quien no lo tiene activado no nota nada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, asUserAal, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

describe.skipIf(!RLS_DB_URL)('RLS · verificación en dos pasos (0049)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;

  const puede = async (user: string, aal: 'aal1' | 'aal2') =>
    asUserAal(sql, user, aal, async (tx) => {
      const [r] = await tx<{ miembro: boolean; admin: boolean; dueno: boolean; stock: boolean; super: boolean; clientes: number }[]>`
        SELECT public.is_member_of_business(${negocio}) AS miembro,
               public.has_min_role(${negocio}, 'staff') AS admin,
               public.has_business_role(${negocio}, 'owner') AS dueno,
               public.member_can(${negocio}, 'adjust_stock') AS stock,
               public.is_super_admin() AS super,
               (SELECT count(*)::int FROM clients WHERE business_id = ${negocio}) AS clientes`;
      return r;
    });

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    await sql`INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Ana')`;
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${owner}, 'super_admin')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin el segundo paso activado, nada cambia', async () => {
    expect(await puede(owner, 'aal1')).toMatchObject({ miembro: true, dueno: true, stock: true, super: true, clientes: 1 });
    expect(await puede(staff, 'aal1')).toMatchObject({ miembro: true, admin: true, dueno: false, clientes: 1 });
  });

  it('un factor sin verificar (alta a medias) tampoco cambia nada', async () => {
    await sql`INSERT INTO auth.mfa_factors (user_id, status) VALUES (${owner}, 'unverified')`;
    expect(await puede(owner, 'aal1')).toMatchObject({ miembro: true, clientes: 1 });
  });

  it('con el segundo paso activado, solo la contraseña no basta', async () => {
    await sql`UPDATE auth.mfa_factors SET status = 'verified' WHERE user_id = ${owner}`;
    expect(await puede(owner, 'aal1')).toEqual({ miembro: false, admin: false, dueno: false, stock: false, super: false, clientes: 0 });
    // Tampoco por las RPC que comprueban el rol.
    await expect(asUserAal(sql, owner, 'aal1', (tx) => tx`
      SELECT * FROM public.create_online_order(_business_id => ${negocio}, _items => ${tx.json([])}, _customer_name => 'X')`))
      .rejects.toThrow(/permisos/);
  });

  it('con el código (aal2), todo como antes', async () => {
    expect(await puede(owner, 'aal2')).toEqual({ miembro: true, admin: true, dueno: true, stock: true, super: true, clientes: 1 });
  });

  it('el segundo paso de una persona no afecta a las demás', async () => {
    expect(await puede(staff, 'aal1')).toMatchObject({ miembro: true, clientes: 1 });
  });
});
