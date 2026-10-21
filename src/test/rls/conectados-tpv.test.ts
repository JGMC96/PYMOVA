// @vitest-environment node
// Conectados al TPV en otros dispositivos (0036): cualquier miembro activo ve quién tiene
// una sesión de vendedor vigente en el negocio, sin el id de la sesión.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

interface Conectado {
  employee_id: string;
  name: string;
  expires_at: Date;
  last_used_at: Date;
}

describe.skipIf(!RLS_DB_URL)('RLS · conectados al TPV en otros dispositivos', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otroNegocio: string;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let ana: string;
  let luis: string;
  let marta: string;

  const conectados = (user: string, biz = negocio) =>
    asUser(sql, user, (tx) => tx<Conectado[]>`SELECT * FROM public.get_connected_sellers(${biz})`);

  const empezar = async (user: string, employee: string, pin: string) => {
    const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${employee}, ${pin})`);
    expect(r.ok).toBe(true);
    return r.session_id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [b2] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = b2.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;

    const alta = async (nombre: string, pin: string) => {
      const [r] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`
        SELECT public.upsert_pos_employee(${negocio}, null, ${nombre}) AS id`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${r.id}, ${pin})`);
      return r.id;
    };
    ana = await alta('Ana', '1111');
    luis = await alta('Luis', '2222');
    marta = await alta('Marta', '3333');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('cada miembro ve a quien está conectado en cualquier dispositivo, sin el id de la sesión', async () => {
    // Ana se conecta en el TPV del propietario y Luis en el del personal.
    await empezar(owner, ana, '1111');
    await empezar(staff, luis, '2222');

    for (const quien of [owner, staff]) {
      const lista = await conectados(quien);
      expect(lista.map((c) => c.name)).toEqual(['Ana', 'Luis']);
      expect(Object.keys(lista[0]).sort()).toEqual(['employee_id', 'expires_at', 'last_used_at', 'name']);
    }
  });

  it('no salen las sesiones caducadas ni las de empleados dados de baja', async () => {
    await empezar(owner, marta, '3333');
    await sql`UPDATE pos_seller_sessions SET expires_at = now() - interval '1 minute' WHERE employee_id = ${marta}`;
    await sql`UPDATE hr_employees SET is_active = false WHERE id = ${luis}`;
    expect((await conectados(owner)).map((c) => c.name)).toEqual(['Ana']);
    await sql`UPDATE hr_employees SET is_active = true WHERE id = ${luis}`;
  });

  it('dos sesiones de la misma persona salen una sola vez, con la caducidad más tardía', async () => {
    await empezar(staff, ana, '1111');
    const lista = await conectados(owner);
    expect(lista.filter((c) => c.name === 'Ana')).toHaveLength(1);
    const [max] = await sql`SELECT max(expires_at) AS m FROM pos_seller_sessions WHERE employee_id = ${ana}`;
    expect(lista.find((c) => c.name === 'Ana')?.expires_at.getTime()).toBe((max.m as Date).getTime());
  });

  it('quien no es miembro, o está suspendido, no ve nada; anon no puede llamarla', async () => {
    expect(await conectados(ajeno)).toHaveLength(0);
    expect(await conectados(owner, otroNegocio)).toHaveLength(0);
    await sql`UPDATE business_members SET is_active = false WHERE business_id = ${negocio} AND user_id = ${staff}`;
    expect(await conectados(staff)).toHaveLength(0);
    await sql`UPDATE business_members SET is_active = true WHERE business_id = ${negocio} AND user_id = ${staff}`;
    await expect(
      asAnon(sql, (tx) => tx`SELECT * FROM public.get_connected_sellers(${negocio})`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('la migración 0036 se puede aplicar dos veces', async () => {
    const file = resolve(__dirname, '../../../drizzle/migrations/0036_conectados_tpv.sql');
    await sql.unsafe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    const [g] = await sql`
      SELECT has_function_privilege('anon', 'public.get_connected_sellers(uuid)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.get_connected_sellers(uuid)', 'EXECUTE') AS auth`;
    expect(g).toEqual({ anon: false, auth: true });
  });
});
