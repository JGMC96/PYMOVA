// @vitest-environment node
// Cambios de plan por RPC y auditoría de las acciones de super admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · super admin: suscripciones y auditoría', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let superAdmin: string;
  let negocio: string;

  const cambiarPlan = (userId: string, args: Record<string, unknown>) =>
    asUser(sql, userId, (tx) => tx`
      SELECT * FROM public.admin_update_subscription(
        _business_id => ${negocio},
        _reason => ${(args.reason as string) ?? null},
        _plan_key => ${(args.plan as string) ?? null},
        _status => ${(args.status as string) ?? null}::subscription_status,
        _trial_ends_at => ${(args.trialEndsAt as string) ?? null}::timestamptz
      )`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
    const [row] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = row.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el super admin cambia el plan con motivo y queda auditado (suscripción y módulos)', async () => {
    const [sub] = await cambiarPlan(superAdmin, { plan: 'pro', status: 'active', reason: 'Cliente piloto' });
    expect(sub.status).toBe('active');

    const [plan] = await sql`
      SELECT p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ${negocio}`;
    expect(plan.key).toBe('pro');

    const [modulos] = await sql`
      SELECT
        (SELECT count(*)::int FROM business_modules WHERE business_id = ${negocio} AND is_enabled) AS activos,
        (SELECT count(*)::int FROM plan_modules pm JOIN plans p ON p.id = pm.plan_id WHERE p.key = 'pro') AS del_plan`;
    expect(modulos.activos).toBe(modulos.del_plan);

    const filas = await sql`
      SELECT table_name, actor_user_id, actor_is_super_admin, reason FROM audit_logs
      WHERE business_id = ${negocio} AND reason = 'Cliente piloto'`;
    const tablas = new Set(filas.map((f) => f.table_name));
    expect(tablas).toEqual(new Set(['subscriptions', 'business_modules']));
    for (const f of filas) {
      expect(f).toMatchObject({ actor_user_id: superAdmin, actor_is_super_admin: true });
    }
  });

  it('la RPC exige ser super admin, un motivo, un plan válido y algún cambio', async () => {
    await expect(cambiarPlan(owner, { plan: 'business', reason: 'Me lo regalo' })).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(cambiarPlan(superAdmin, { plan: 'business', reason: '  ' })).rejects.toThrow(/motivo/i);
    await expect(cambiarPlan(superAdmin, { plan: 'no-existe', reason: 'Prueba' })).rejects.toThrow(/plan/i);
    await expect(cambiarPlan(superAdmin, { reason: 'Nada que cambiar' })).rejects.toThrow(/cambio/i);
  });

  it('el super admin ya no puede editar subscriptions directamente', async () => {
    const r = await asUser(sql, superAdmin, (tx) => tx`
      UPDATE subscriptions SET status = 'cancelled' WHERE business_id = ${negocio}`);
    expect(r.count).toBe(0);
    const vistas = await asUser(sql, superAdmin, (tx) => tx`SELECT id FROM subscriptions WHERE business_id = ${negocio}`);
    expect(vistas.length).toBe(1);
  });

  it('dar y quitar el rol de super admin queda auditado', async () => {
    const nuevo = await createUser(sql, 'nuevo-super@ejemplo.test');
    await asUser(sql, superAdmin, (tx) => tx`INSERT INTO platform_roles (user_id, role) VALUES (${nuevo}, 'super_admin')`);
    await asUser(sql, superAdmin, (tx) => tx`DELETE FROM platform_roles WHERE user_id = ${nuevo}`);

    const filas = await sql`
      SELECT action, actor_is_super_admin FROM audit_logs
      WHERE table_name = 'platform_roles' AND coalesce(new_data, old_data)->>'user_id' = ${nuevo}
      ORDER BY created_at`;
    expect(filas).toEqual([
      { action: 'INSERT', actor_is_super_admin: true },
      { action: 'DELETE', actor_is_super_admin: true },
    ]);
  });

  it('get_platform_audit_log: el super admin ve la actividad con correo y motivo; el owner no', async () => {
    const filas = await asUser(sql, superAdmin, (tx) => tx`SELECT * FROM public.get_platform_audit_log(50, 0, null)`);
    const cambio = filas.find((f) => f.table_name === 'subscriptions' && f.reason === 'Cliente piloto');
    expect(cambio).toMatchObject({
      actor_email: 'super@ejemplo.test',
      business_id: negocio,
      business_name: 'Tienda',
      action: 'UPDATE',
    });

    const filtradas = await asUser(sql, superAdmin, (tx) => tx`SELECT * FROM public.get_platform_audit_log(50, 0, ${negocio})`);
    expect(filtradas.every((f) => f.business_id === negocio)).toBe(true);

    await expect(
      asUser(sql, owner, (tx) => tx`SELECT * FROM public.get_platform_audit_log(50, 0, null)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('las acciones normales del owner se auditan sin marca de super admin y no salen en Actividad', async () => {
    await asUser(sql, owner, (tx) => tx`UPDATE business_settings SET invoice_prefix = 'T-' WHERE business_id = ${negocio}`);
    const [fila] = await sql`
      SELECT actor_is_super_admin FROM audit_logs
      WHERE table_name = 'business_settings' AND action = 'UPDATE' AND business_id = ${negocio}`;
    expect(fila.actor_is_super_admin).toBe(false);

    const actividad = await asUser(sql, superAdmin, (tx) => tx`SELECT table_name FROM public.get_platform_audit_log(200, 0, ${negocio})`);
    expect(actividad.some((f) => f.table_name === 'business_settings')).toBe(false);
  });
});
