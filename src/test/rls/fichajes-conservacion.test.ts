// @vitest-environment node
// 0056: el registro de jornada no se puede perder (se conserva 4 años), baja de empleados en
// vez de borrado y jornadas sin salida por revisar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb, type Tx } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
type Fichaje = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

describe.skipIf(!RLS_DB_URL)('RLS · conservación del registro de jornada (0056)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;

  async function nuevoMiembro(email: string, biz = negocio, role = 'staff'): Promise<string> {
    const user = await createUser(sql, email);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${biz}, ${user}, ${role}, true)`;
    return user;
  }

  const fichar = (user: string, tipo: Fichaje, biz = negocio) =>
    asUser(sql, user, (tx) => tx`SELECT public.clock_action(${biz}, ${tipo}::public.time_entry_type) AS id`);

  async function empleadoDe(user: string, biz = negocio): Promise<string> {
    const [e] = await sql<{ id: string }[]>`SELECT id FROM hr_employees WHERE business_id = ${biz} AND user_id = ${user}`;
    return e.id;
  }

  const contar = async (tabla: string, employeeId: string) => {
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${tabla} WHERE employee_id = $1`, [employeeId]);
    return r.n as number;
  };

  /** Preparación de datos sin triggers (solo en tests): simula el paso del tiempo. */
  const mantenimiento = (fn: (tx: Tx) => Promise<unknown>) =>
    sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await fn(tx);
    });

  const nuevoNegocio = async (nombre: string) => {
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
    return b.id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    negocio = await nuevoNegocio('Tienda');
    admin = await nuevoMiembro('admin@ejemplo.test', negocio, 'admin');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('nadie borra un empleado con fichajes, ni con service_role: se da de baja', async () => {
    const ana = await nuevoMiembro('ana@ejemplo.test');
    await fichar(ana, 'clock_in');
    await fichar(ana, 'clock_out');
    const emp = await empleadoDe(ana);

    await expect(
      asUser(sql, admin, (tx) => tx`DELETE FROM hr_employees WHERE id = ${emp}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, owner, (tx) => tx`DELETE FROM hr_employees WHERE id = ${emp}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asService(sql, (tx) => tx`DELETE FROM hr_employees WHERE id = ${emp}`)).rejects.toThrow(/dalo de baja/);
    await expect(sql`DELETE FROM hr_employees WHERE id = ${emp}`).rejects.toThrow(/dalo de baja/);

    expect(await contar('hr_time_entries', emp)).toBe(2);
    expect(await contar('hr_work_sessions', emp)).toBe(1);

    // El admin sigue pudiendo dar de alta y cambiar empleados.
    const nuevo = await createUser(sql, 'alta@ejemplo.test');
    await asUser(sql, admin, (tx) => tx`
      INSERT INTO hr_employees (business_id, user_id, hire_date) VALUES (${negocio}, ${nuevo}, CURRENT_DATE)`);
    const r = await asUser(sql, admin, (tx) => tx`UPDATE hr_employees SET weekly_hours = 20 WHERE id = ${emp}`);
    expect(r.count).toBe(1);
  });

  it('los fichajes no se cambian nunca y no se borran en 4 años; las jornadas tampoco se borran', async () => {
    const bea = await nuevoMiembro('bea@ejemplo.test');
    await fichar(bea, 'clock_in');
    await fichar(bea, 'clock_out');
    const emp = await empleadoDe(bea);

    await expect(
      asService(sql, (tx) => tx`UPDATE hr_time_entries SET occurred_at = occurred_at - interval '1 hour' WHERE employee_id = ${emp}`),
    ).rejects.toThrow(/no se pueden modificar/);
    await expect(asService(sql, (tx) => tx`DELETE FROM hr_time_entries WHERE employee_id = ${emp}`)).rejects.toThrow(/4 años/);
    await expect(sql`DELETE FROM hr_time_entries WHERE employee_id = ${emp}`).rejects.toThrow(/4 años/);
    await expect(sql`DELETE FROM hr_work_sessions WHERE employee_id = ${emp}`).rejects.toThrow(/4 años/);
    await expect(sql`TRUNCATE hr_time_entries CASCADE`).rejects.toThrow(/vaciar/);
    await expect(sql`TRUNCATE hr_work_sessions CASCADE`).rejects.toThrow(/vaciar/);
    await expect(sql`TRUNCATE hr_employees CASCADE`).rejects.toThrow(/vaciar/);

    expect(await contar('hr_time_entries', emp)).toBe(2);
    expect(await contar('hr_work_sessions', emp)).toBe(1);

    // anon no tiene ningún permiso sobre la plantilla.
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM hr_employees`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('pasados 4 años, los registros sí se pueden borrar (pero no cambiar)', async () => {
    const cris = await nuevoMiembro('cris@ejemplo.test');
    await fichar(cris, 'clock_in');
    await fichar(cris, 'clock_out');
    const emp = await empleadoDe(cris);
    await mantenimiento(async (tx) => {
      await tx`UPDATE hr_time_entries SET occurred_at = occurred_at - interval '5 years' WHERE employee_id = ${emp}`;
      await tx`
        UPDATE hr_work_sessions
        SET clock_in_at = clock_in_at - interval '5 years', clock_out_at = clock_out_at - interval '5 years',
            session_date = session_date - interval '5 years'
        WHERE employee_id = ${emp}`;
    });

    await expect(sql`UPDATE hr_time_entries SET notes = 'x' WHERE employee_id = ${emp}`).rejects.toThrow(/no se pueden modificar/);
    const borrados = await sql`DELETE FROM hr_time_entries WHERE employee_id = ${emp}`;
    expect(borrados.count).toBe(2);
    const sesiones = await sql`DELETE FROM hr_work_sessions WHERE employee_id = ${emp}`;
    expect(sesiones.count).toBe(1);
    const empleado = await sql`DELETE FROM hr_employees WHERE id = ${emp}`;
    expect(empleado.count).toBe(1);
  });

  it('un negocio con fichajes no se borra (ni el propietario ni el super admin); sin fichajes, sí', async () => {
    const conFichajes = await nuevoNegocio('Con fichajes');
    const dani = await nuevoMiembro('dani@ejemplo.test', conFichajes);
    await fichar(dani, 'clock_in', conFichajes);

    await expect(
      asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${conFichajes}`),
    ).rejects.toThrow(/registros de jornada de los últimos 4 años/);
    const superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
    await expect(
      asUser(sql, superAdmin, (tx) => tx`DELETE FROM businesses WHERE id = ${conFichajes}`),
    ).rejects.toThrow(/registros de jornada/);
    const [sigue] = await sql`SELECT count(*)::int AS n FROM businesses WHERE id = ${conFichajes}`;
    expect(sigue.n).toBe(1);

    // Sin fichajes (aunque tenga empleados) se borra como antes.
    const sinFichajes = await nuevoNegocio('Sin fichajes');
    const eva = await nuevoMiembro('eva@ejemplo.test', sinFichajes);
    await sql`INSERT INTO hr_employees (business_id, user_id, hire_date) VALUES (${sinFichajes}, ${eva}, CURRENT_DATE)`;
    const r = await asUser(sql, owner, (tx) => tx`DELETE FROM businesses WHERE id = ${sinFichajes}`);
    expect(r.count).toBe(1);
  });

  it('al quitar a un miembro, su jornada abierta queda cerrada y pendiente de revisión', async () => {
    const fede = await nuevoMiembro('fede@ejemplo.test');
    await fichar(fede, 'clock_in');
    const emp = await empleadoDe(fede);

    await asUser(sql, owner, (tx) => tx`SELECT public.remove_member(${negocio}, ${fede})`);

    const [e] = await sql`SELECT is_active FROM hr_employees WHERE id = ${emp}`;
    expect(e.is_active).toBe(false);
    const [s] = await sql`SELECT status, needs_review, worked_seconds FROM hr_work_sessions WHERE employee_id = ${emp}`;
    expect(s).toEqual({ status: 'closed', needs_review: true, worked_seconds: 0 });
    expect(await contar('hr_time_entries', emp)).toBe(1);
  });

  it('al dar de baja a un dependiente del TPV: jornada a revisión, sin sesiones ni PIN', async () => {
    const [{ id: rita }] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
      SELECT public.upsert_pos_employee(${negocio}, null, 'Rita') AS id`);
    await asUser(sql, admin, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${rita}, '4321')`);
    const [inicio] = await asUser(sql, owner, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${rita}, '4321')`);
    expect(inicio.ok).toBe(true);
    await asUser(sql, owner, (tx) => tx`
      SELECT public.clock_action(${negocio}, 'clock_in'::public.time_entry_type, _seller_session_id => ${inicio.session_id})`);

    await asUser(sql, admin, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, ${rita}, 'Rita', false)`);

    expect(await contar('hr_employee_pins', rita)).toBe(0);
    expect(await contar('pos_seller_sessions', rita)).toBe(0);
    const [s] = await sql`SELECT status, needs_review FROM hr_work_sessions WHERE employee_id = ${rita}`;
    expect(s).toEqual({ status: 'closed', needs_review: true });
    expect(await contar('hr_time_entries', rita)).toBe(1);

    // Si vuelve, entra sin PIN y hay que ponerle uno nuevo.
    await asUser(sql, admin, (tx) => tx`SELECT public.upsert_pos_employee(${negocio}, ${rita}, 'Rita', true)`);
    const [fila] = await asUser(sql, admin, (tx) => tx<{ has_pin: boolean }[]>`
      SELECT has_pin FROM public.get_pos_employees(${negocio}) WHERE id = ${rita}`);
    expect(fila.has_pin).toBe(false);
  });

  it('el interruptor «Activo» del admin también cierra la jornada abierta', async () => {
    const gil = await nuevoMiembro('gil@ejemplo.test');
    await fichar(gil, 'clock_in');
    const emp = await empleadoDe(gil);

    await asUser(sql, admin, (tx) => tx`UPDATE hr_employees SET is_active = false WHERE id = ${emp}`);

    const [s] = await sql`SELECT status, needs_review FROM hr_work_sessions WHERE employee_id = ${emp}`;
    expect(s).toEqual({ status: 'closed', needs_review: true });
  });

  it('jornadas por revisar: pendientes y abiertas hace más de 12 h, solo para administradores', async () => {
    const hugo = await nuevoMiembro('hugo@ejemplo.test');
    await fichar(hugo, 'clock_in');
    const emp = await empleadoDe(hugo);
    const irene = await nuevoMiembro('irene@ejemplo.test');
    await fichar(irene, 'clock_in'); // abierta hace poco: no sale
    const empIrene = await empleadoDe(irene);

    let pendientes = await asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${negocio})`);
    expect(pendientes.some((p) => p.employee_id === emp)).toBe(false);

    await mantenimiento(async (tx) => {
      await tx`UPDATE hr_work_sessions SET clock_in_at = clock_in_at - interval '13 hours' WHERE employee_id = ${emp}`;
      await tx`UPDATE hr_time_entries SET occurred_at = occurred_at - interval '13 hours' WHERE employee_id = ${emp}`;
    });

    pendientes = await asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${negocio})`);
    const deHugo = pendientes.find((p) => p.employee_id === emp);
    expect(deHugo).toMatchObject({ status: 'open', needs_review: false, employee_name: expect.any(String) });
    // Las de las bajas anteriores (pendientes de revisión) también salen.
    expect(pendientes.filter((p) => p.needs_review).length).toBeGreaterThanOrEqual(3);
    expect(pendientes.some((p) => p.employee_id === empIrene)).toBe(false);

    // El admin la cierra con el flujo de siempre y deja de salir.
    const salida = new Date(Date.now() - 4 * 3600_000).toISOString();
    const entrada = new Date(Date.now() - 12 * 3600_000).toISOString();
    await asUser(sql, admin, (tx) => tx`
      SELECT public.correct_work_session(${deHugo.id}, ${entrada}::timestamptz, ${salida}::timestamptz, 0, 'Olvidó fichar la salida')`);
    pendientes = await asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${negocio})`);
    expect(pendientes.some((p) => p.id === deHugo.id)).toBe(false);

    await expect(
      asUser(sql, hugo, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${negocio})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const otro = await nuevoNegocio('Otro');
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${otro})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asAnon(sql, (tx) => tx`SELECT * FROM public.get_hr_pending_reviews(${negocio})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });
});
