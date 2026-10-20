// @vitest-environment node
// Gestión del equipo (0035): quitar miembros, salir de un negocio, transferir la propiedad
// y no quedarse nunca sin un propietario activo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · gestión del equipo', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let admin2: string;
  let staff: string;

  const miembro = async (user: string) => {
    const [m] = await sql`SELECT role, is_active FROM business_members WHERE business_id = ${negocio} AND user_id = ${user}`;
    return m as { role: string; is_active: boolean } | undefined;
  };
  const quitar = (quien: string, a: string) => asUser(sql, quien, (tx) => tx`SELECT public.remove_member(${negocio}, ${a})`);

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
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el único propietario no se degrada, ni se suspende, ni se borra', async () => {
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE business_members SET role = 'admin' WHERE business_id = ${negocio} AND user_id = ${owner}`),
    ).rejects.toThrow(/al menos un propietario/);
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE business_members SET is_active = false WHERE business_id = ${negocio} AND user_id = ${owner}`),
    ).rejects.toThrow(/al menos un propietario/);
    await expect(
      asUser(sql, owner, (tx) => tx`DELETE FROM business_members WHERE business_id = ${negocio} AND user_id = ${owner}`),
    ).rejects.toThrow(/al menos un propietario/);
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.leave_business(${negocio})`)).rejects.toThrow(/al menos un propietario/);
    expect(await miembro(owner)).toEqual({ role: 'owner', is_active: true });
  });

  it('quitar: el propietario a cualquiera; un administrador solo a personal; nadie a sí mismo', async () => {
    // El personal deja ficha de RR. HH., sesión de vendedor y negocio activo.
    const [e] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${e.id}, '1234')`);
    await asUser(sql, staff, (tx) => tx`SELECT * FROM public.start_seller_session(${negocio}, ${e.id}, '1234')`);
    await sql`UPDATE profiles SET active_business_id = ${negocio} WHERE id = ${staff}`;

    await expect(quitar(staff, admin)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(quitar(admin, admin2)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(quitar(admin, owner)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(quitar(admin, admin)).rejects.toThrow(/Salir del negocio/);

    await quitar(admin, staff);
    expect(await miembro(staff)).toBeUndefined();
    const [emp] = await sql`SELECT is_active FROM hr_employees WHERE id = ${e.id}`;
    expect(emp.is_active).toBe(false);
    const [s] = await sql`SELECT count(*)::int AS n FROM pos_seller_sessions WHERE employee_id = ${e.id}`;
    expect(s.n).toBe(0);
    const [p] = await sql`SELECT active_business_id FROM profiles WHERE id = ${staff}`;
    expect(p.active_business_id).toBeNull();
    // Ya no es miembro: no ve nada del negocio.
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM products WHERE business_id = ${negocio}`)).toHaveLength(0);

    await quitar(owner, admin2);
    expect(await miembro(admin2)).toBeUndefined();
  });

  it('salir: cualquiera menos el último propietario', async () => {
    await asUser(sql, admin, (tx) => tx`SELECT public.leave_business(${negocio})`);
    expect(await miembro(admin)).toBeUndefined();
    const ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT public.leave_business(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    // Vuelven para las pruebas siguientes.
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
  });

  it('transferir la propiedad: solo un propietario, a un miembro activo; puede quedarse o pasar a administrador', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT public.transfer_ownership(${negocio}, ${staff})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const ajeno = await createUser(sql, 'ajeno2@ejemplo.test');
    await expect(
      asUser(sql, owner, (tx) => tx`SELECT public.transfer_ownership(${negocio}, ${ajeno})`),
    ).rejects.toThrow(/miembro activo/);
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.transfer_ownership(${negocio}, ${owner})`)).rejects.toThrow(/otra persona/);

    // Con «seguir siendo propietario»: dos propietarios.
    await asUser(sql, owner, (tx) => tx`SELECT public.transfer_ownership(${negocio}, ${admin}, true)`);
    expect(await miembro(admin)).toEqual({ role: 'owner', is_active: true });
    expect(await miembro(owner)).toEqual({ role: 'owner', is_active: true });
    // Con dos propietarios, uno ya puede salir.
    await asUser(sql, admin, (tx) => tx`SELECT public.leave_business(${negocio})`);
    expect(await miembro(admin)).toBeUndefined();

    // Sin quedarse: el actual pasa a administrador.
    await asUser(sql, owner, (tx) => tx`SELECT public.transfer_ownership(${negocio}, ${staff})`);
    expect(await miembro(staff)).toEqual({ role: 'owner', is_active: true });
    expect(await miembro(owner)).toEqual({ role: 'admin', is_active: true });
  });

  it('la migración 0035 se puede aplicar dos veces', async () => {
    const file = resolve(__dirname, '../../../drizzle/migrations/0035_equipo_gestion.sql');
    await sql.unsafe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    const [t] = await sql`
      SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgrelid = 'public.business_members'::regclass AND tgname = 'trg_protect_last_owner'`;
    expect(t.n).toBe(1);
    // Sin permisos para el público ni para anon en las RPC nuevas.
    const [g] = await sql`
      SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon,
             bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('remove_member', 'leave_business', 'transfer_ownership')`;
    expect(g).toEqual({ anon: false, auth: true });
    const [i] = await sql`
      SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('retire_member', 'protect_last_owner')`;
    expect(i.auth).toBe(false);
  });

  it('borrar el negocio entero sigue funcionando', async () => {
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    const r = await asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${b.id}`);
    expect(r.count).toBe(1);
    const [m] = await sql`SELECT count(*)::int AS n FROM business_members WHERE business_id = ${b.id}`;
    expect(m.n).toBe(0);
  });
});
