// @vitest-environment node
// Alta de negocios y aislamiento entre negocios (C1, A5 y A13 de docs/AUDITORIA.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · alta de negocios', () => {
  let db: TestDb;
  let sql: Sql;
  let victima: string;
  let atacante: string;
  let negocioVictima: string;

  const crearNegocio = (userId: string, nombre: string, sector: string | null = null) =>
    asUser(sql, userId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`SELECT public.create_business(${nombre}, ${sector}) AS id`;
      return row.id;
    });

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    victima = await createUser(sql, 'victima@ejemplo.test');
    atacante = await createUser(sql, 'atacante@ejemplo.test');
    negocioVictima = await crearNegocio(victima, 'Negocio víctima');
    await sql`INSERT INTO clients (business_id, name) VALUES (${negocioVictima}, 'Cliente privado')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('C1: un usuario sin negocios no puede darse de alta como owner en un negocio ajeno', async () => {
    await expect(
      asUser(sql, atacante, (tx) => tx`
        INSERT INTO business_members (business_id, user_id, role, is_active)
        VALUES (${negocioVictima}, ${atacante}, 'owner', true)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    await expect(
      asUser(sql, atacante, (tx) => tx`
        INSERT INTO business_members (business_id, user_id, role, is_active)
        VALUES (${negocioVictima}, ${atacante}, 'staff', true)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const visibles = await asUser(sql, atacante, (tx) =>
      tx`SELECT count(*)::int AS n FROM clients WHERE business_id = ${negocioVictima}`);
    expect(visibles[0].n).toBe(0);
  });

  it('no se pueden crear negocios con un INSERT directo', async () => {
    await expect(
      asUser(sql, atacante, (tx) => tx`INSERT INTO businesses (name, slug) VALUES ('Directo', 'directo')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('create_business crea negocio, owner, suscripción trial, módulos, ajustes y negocio activo', async () => {
    const userId = await createUser(sql, 'nuevo@ejemplo.test');
    const id = await crearNegocio(userId, '  Zapatería Ñandú  ', 'retail');

    const [negocio] = await sql`SELECT name, slug, industry, currency, timezone FROM businesses WHERE id = ${id}`;
    expect(negocio).toMatchObject({
      name: 'Zapatería Ñandú',
      slug: 'zapateria-nandu',
      industry: 'retail',
      currency: 'EUR',
      timezone: 'Europe/Madrid',
    });

    const miembros = await sql`SELECT user_id, role, is_active FROM business_members WHERE business_id = ${id}`;
    expect(miembros).toEqual([{ user_id: userId, role: 'owner', is_active: true }]);

    const [sub] = await sql`
      SELECT s.status, p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ${id}`;
    expect(sub).toMatchObject({ status: 'trialing', key: 'trial' });

    const [modulos] = await sql`
      SELECT
        (SELECT count(*)::int FROM business_modules WHERE business_id = ${id} AND is_enabled) AS activos,
        (SELECT count(*)::int FROM plan_modules pm JOIN plans p ON p.id = pm.plan_id WHERE p.key = 'trial') AS del_plan`;
    expect(modulos.activos).toBe(modulos.del_plan);
    expect(modulos.activos).toBeGreaterThan(0);

    const [ajustes] = await sql`
      SELECT tax_rate::float AS tax_rate, invoice_prefix, next_invoice_number FROM business_settings WHERE business_id = ${id}`;
    expect(ajustes).toEqual({ tax_rate: 21, invoice_prefix: 'FAC-', next_invoice_number: 1 });

    const [perfil] = await sql`SELECT active_business_id FROM profiles WHERE id = ${userId}`;
    expect(perfil.active_business_id).toBe(id);

    // El owner ve su negocio con la RLS normal
    const vistos = await asUser(sql, userId, (tx) => tx`SELECT id FROM businesses`);
    expect(vistos.map((r) => r.id)).toEqual([id]);
  });

  it('dos negocios con el mismo nombre reciben slugs distintos', async () => {
    const userId = await createUser(sql, 'repetido@ejemplo.test');
    const a = await crearNegocio(userId, 'Tienda Repetida');
    const b = await crearNegocio(userId, 'Tienda Repetida');
    const filas = await sql`SELECT slug FROM businesses WHERE id IN (${a}, ${b}) ORDER BY created_at`;
    expect(filas[0].slug).toBe('tienda-repetida');
    expect(filas[1].slug).not.toBe(filas[0].slug);
    expect(filas[1].slug).toMatch(/^tienda-repetida-/);
  });

  it('rechaza un nombre vacío', async () => {
    await expect(crearNegocio(atacante, '   ')).rejects.toThrow(/nombre/i);
  });

  it('limita a 10 los negocios propios de un usuario', async () => {
    const userId = await createUser(sql, 'limite@ejemplo.test');
    for (let i = 1; i <= 10; i++) await crearNegocio(userId, `Negocio ${i}`);
    await expect(crearNegocio(userId, 'Negocio 11')).rejects.toThrow(/10/);
  }, 30_000);

  it('anon no puede ejecutar create_business', async () => {
    await expect(
      asAnon(sql, (tx) => tx`SELECT public.create_business('Anónimo', null)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('A5: el owner no puede cambiarse de plan ni activar módulos', async () => {
    const actualizadas = await asUser(sql, victima, (tx) => tx`
      UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE key = 'business')
      WHERE business_id = ${negocioVictima}`);
    expect(actualizadas.count).toBe(0);

    const [plan] = await sql`
      SELECT p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ${negocioVictima}`;
    expect(plan.key).toBe('trial');

    await expect(
      asUser(sql, victima, (tx) => tx`
        INSERT INTO business_modules (business_id, module_id, is_enabled)
        SELECT ${negocioVictima}, m.id, true FROM modules m
        WHERE NOT EXISTS (SELECT 1 FROM business_modules bm WHERE bm.business_id = ${negocioVictima} AND bm.module_id = m.id)
        LIMIT 1`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const desactivados = await asUser(sql, victima, (tx) => tx`
      UPDATE business_modules SET is_enabled = true WHERE business_id = ${negocioVictima}`);
    expect(desactivados.count).toBe(0);
  });

  it('el super admin sí puede cambiar el plan (con la RPC y un motivo)', async () => {
    const superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
    const [sub] = await asUser(sql, superAdmin, (tx) => tx`
      SELECT * FROM public.admin_update_subscription(${negocioVictima}, 'Prueba de alta', 'pro')`);
    expect(sub.business_id).toBe(negocioVictima);
    const [plan] = await sql`
      SELECT p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ${negocioVictima}`;
    expect(plan.key).toBe('pro');
    await sql`UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE key = 'trial') WHERE business_id = ${negocioVictima}`;
  });

  it('siguen funcionando las altas legítimas: owner → admin, admin → staff e invitaciones', async () => {
    const admin = await createUser(sql, 'admin@ejemplo.test');
    const staff = await createUser(sql, 'staff@ejemplo.test');
    const otroOwner = await createUser(sql, 'otro-owner@ejemplo.test');
    const invitado = await createUser(sql, 'invitado@ejemplo.test');

    await asUser(sql, victima, (tx) => tx`
      INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocioVictima}, ${admin}, 'admin', true)`);
    await asUser(sql, admin, (tx) => tx`
      INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocioVictima}, ${staff}, 'staff', true)`);
    await expect(
      asUser(sql, admin, (tx) => tx`
        INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocioVictima}, ${otroOwner}, 'owner', true)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const [inv] = await asUser(sql, victima, (tx) => tx<{ token: string }[]>`
      INSERT INTO business_invitations (business_id, email, role, invited_by)
      VALUES (${negocioVictima}, 'invitado@ejemplo.test', 'staff', ${victima}) RETURNING token`);
    const [aceptada] = await asUser(sql, invitado, (tx) =>
      tx`SELECT public.accept_business_invitation(${inv.token}) AS business_id`);
    expect(aceptada.business_id).toBe(negocioVictima);

    const roles = await sql`
      SELECT u.email, m.role FROM business_members m JOIN auth.users u ON u.id = m.user_id
      WHERE m.business_id = ${negocioVictima} ORDER BY u.email`;
    expect(roles).toEqual([
      { email: 'admin@ejemplo.test', role: 'admin' },
      { email: 'invitado@ejemplo.test', role: 'staff' },
      { email: 'staff@ejemplo.test', role: 'staff' },
      { email: 'victima@ejemplo.test', role: 'owner' },
    ]);
  });
});
