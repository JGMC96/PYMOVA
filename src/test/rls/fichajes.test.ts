// @vitest-environment node
// A4 de docs/AUDITORIA.md: fichajes solo por RPC, día en la zona horaria del
// negocio, jornada partida, olvidos y correcciones con motivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb, type Tx } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
type Fichaje = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

describe.skipIf(!RLS_DB_URL)('RLS · fichajes solo por RPC (A4)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;

  /** Crea un empleado (miembro staff) del negocio. */
  async function nuevoEmpleado(email: string): Promise<string> {
    const user = await createUser(sql, email);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${user}, 'staff', true)`;
    return user;
  }

  const fichar = (user: string, tipo: Fichaje) =>
    asUser(sql, user, (tx) => tx`SELECT public.clock_action(${negocio}, ${tipo}::public.time_entry_type) AS id`);

  async function empleadoDe(user: string): Promise<string> {
    const [e] = await sql<{ id: string }[]>`SELECT id FROM hr_employees WHERE business_id = ${negocio} AND user_id = ${user}`;
    return e.id;
  }

  const sesiones = (empleado: string) =>
    sql`SELECT * FROM hr_work_sessions WHERE employee_id = ${empleado} ORDER BY clock_in_at`;

  /** Preparación de datos sin triggers (solo en tests): desde la 0056 los fichajes no se cambian ni se borran. */
  const mantenimiento = (fn: (tx: Tx) => Promise<unknown>) =>
    sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await fn(tx);
    });

  /** Retrasa la sesión abierta (y sus fichajes) para simular el paso del tiempo. */
  async function retrasar(empleado: string, horas: number, cambiarDia = false) {
    await mantenimiento(async (tx) => {
      await tx`
        UPDATE hr_work_sessions
        SET clock_in_at = clock_in_at - make_interval(hours => ${horas}),
            session_date = CASE WHEN ${cambiarDia} THEN session_date - 1 ELSE session_date END
        WHERE employee_id = ${empleado} AND status = 'open'`;
      await tx`UPDATE hr_time_entries SET occurred_at = occurred_at - make_interval(hours => ${horas}) WHERE employee_id = ${empleado}`;
    });
  }

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    admin = await createUser(sql, 'admin@ejemplo.test');
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${admin}, 'admin', true)`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('nadie escribe directamente en los fichajes ni en las sesiones; anon no los ve', async () => {
    const ana = await nuevoEmpleado('ana@ejemplo.test');
    await fichar(ana, 'clock_in');
    const emp = await empleadoDe(ana);

    await expect(
      asUser(sql, ana, (tx) => tx`
        INSERT INTO hr_time_entries (business_id, employee_id, entry_type, occurred_at)
        VALUES (${negocio}, ${emp}, 'clock_out', now() + interval '8 hours')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, ana, (tx) => tx`UPDATE hr_time_entries SET occurred_at = now() - interval '1 hour' WHERE employee_id = ${emp}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`
        INSERT INTO hr_time_entries (business_id, employee_id, entry_type) VALUES (${negocio}, ${emp}, 'clock_out')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE hr_work_sessions SET worked_seconds = 99999 WHERE employee_id = ${emp}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`DELETE FROM hr_time_entries WHERE employee_id = ${emp}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM hr_time_entries`)).rejects.toMatchObject(PERMISO_DENEGADO);

    const propios = await asUser(sql, ana, (tx) => tx`SELECT id FROM hr_time_entries WHERE employee_id = ${emp}`);
    expect(propios.length).toBe(1);
  });

  it('secuencia completa y transiciones inválidas', async () => {
    const bea = await nuevoEmpleado('bea@ejemplo.test');
    await expect(fichar(bea, 'clock_out')).rejects.toThrow(/no hay sesión abierta/i);
    await fichar(bea, 'clock_in');
    await expect(fichar(bea, 'clock_in')).rejects.toThrow(/sesión abierta/i);
    await expect(fichar(bea, 'break_end')).rejects.toThrow(/no hay pausa/i);
    await fichar(bea, 'break_start');
    await expect(fichar(bea, 'break_start')).rejects.toThrow(/pausa/i);
    await fichar(bea, 'break_end');
    await fichar(bea, 'clock_out');

    const [s] = await sesiones(await empleadoDe(bea));
    expect(s.status).toBe('closed');
    expect(s.clock_out_at).not.toBeNull();
  });

  it('jornada partida: mañana y tarde son dos sesiones y la pausa del mediodía no cuenta', async () => {
    const carla = await nuevoEmpleado('carla@ejemplo.test');
    await fichar(carla, 'clock_in');
    await fichar(carla, 'clock_out');
    await fichar(carla, 'clock_in');
    await fichar(carla, 'clock_out');

    const filas = await sesiones(await empleadoDe(carla));
    expect(filas.length).toBe(2);
    expect(filas[0].session_date).toEqual(filas[1].session_date);
    expect(filas[1].clock_in_at.getTime()).toBeGreaterThanOrEqual(filas[0].clock_out_at.getTime());
    expect(filas.every((f) => f.status === 'closed')).toBe(true);
  });

  it('un turno que pasa de medianoche se ve en el panel y se puede cerrar', async () => {
    const dani = await nuevoEmpleado('dani@ejemplo.test');
    await fichar(dani, 'clock_in');
    const emp = await empleadoDe(dani);
    await retrasar(emp, 3, true);

    const [panel] = await asUser(sql, dani, (tx) => tx`SELECT * FROM public.get_hr_dashboard(${negocio})`);
    expect(panel.my_session_status).toBe('open');
    expect(panel.my_last_entry_type).toBe('clock_in');

    await fichar(dani, 'clock_out');
    const [s] = await sesiones(emp);
    expect(s.status).toBe('closed');
    expect(s.worked_seconds).toBeGreaterThanOrEqual(3 * 3600 - 5);
  });

  it('olvido: una sesión abierta más de 12 h queda pendiente de revisión y se puede volver a entrar', async () => {
    const eva = await nuevoEmpleado('eva@ejemplo.test');
    await fichar(eva, 'clock_in');
    const emp = await empleadoDe(eva);
    await retrasar(emp, 13);

    await expect(fichar(eva, 'break_start')).rejects.toThrow(/12 h/i);
    await fichar(eva, 'clock_in');
    const [vieja, nueva] = await sesiones(emp);
    expect(vieja).toMatchObject({ status: 'closed', needs_review: true, worked_seconds: 0, clock_out_at: null });
    expect(nueva).toMatchObject({ status: 'open', needs_review: false });

    const [panel] = await asUser(sql, eva, (tx) => tx`SELECT * FROM public.get_hr_dashboard(${negocio})`);
    expect(Number(panel.my_pending_reviews)).toBe(1);

    // Fichar la salida de una sesión olvidada la cierra pendiente de revisión, sin horas.
    await retrasar(emp, 13);
    await fichar(eva, 'clock_out');
    const filas = await sesiones(emp);
    expect(filas[1]).toMatchObject({ status: 'closed', needs_review: true, worked_seconds: 0 });
    expect(filas[1].clock_out_at).not.toBeNull();
  });

  it('el día se calcula en la zona horaria del negocio', async () => {
    const [madrid] = await asUser(sql, owner, (tx) => tx`
      SELECT public.business_local_date(${negocio}, '2026-10-19 23:30+00') AS d`);
    expect(madrid.d.toISOString().slice(0, 10)).toBe('2026-10-20');

    await sql`UPDATE businesses SET timezone = 'America/Mexico_City' WHERE id = ${negocio}`;
    const [mexico] = await asUser(sql, owner, (tx) => tx`
      SELECT public.business_local_date(${negocio}, '2026-10-19 23:30+00') AS d`);
    await sql`UPDATE businesses SET timezone = 'Europe/Madrid' WHERE id = ${negocio}`;
    expect(mexico.d.toISOString().slice(0, 10)).toBe('2026-10-19');

    const ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT public.business_local_date(${negocio}, now())`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('cinco entradas a la vez abren una sola sesión', async () => {
    const fran = await nuevoEmpleado('fran@ejemplo.test');
    await sql`INSERT INTO hr_employees (business_id, user_id, hire_date) VALUES (${negocio}, ${fran}, CURRENT_DATE)`;
    const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => fichar(fran, 'clock_in')));
    expect(resultados.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const filas = await sesiones(await empleadoDe(fran));
    expect(filas.length).toBe(1);
    const [n] = await sql`SELECT count(*)::int AS n FROM hr_time_entries WHERE employee_id = ${filas[0].employee_id}`;
    expect(n.n).toBe(1);
  }, 30_000);

  it('correcciones: solo admins, con motivo, sin solapes y con el motivo en la auditoría', async () => {
    const gema = await nuevoEmpleado('gema@ejemplo.test');
    await fichar(gema, 'clock_in');
    await fichar(gema, 'clock_out');
    const emp = await empleadoDe(gema);
    await mantenimiento((tx) => tx`DELETE FROM hr_work_sessions WHERE employee_id = ${emp}`);
    const [olvidada] = await sql<{ id: string }[]>`
      INSERT INTO hr_work_sessions (business_id, employee_id, session_date, clock_in_at, status, needs_review)
      VALUES (${negocio}, ${emp}, '2026-10-14', '2026-10-14 09:00+00', 'closed', true) RETURNING id`;
    await sql`
      INSERT INTO hr_work_sessions (business_id, employee_id, session_date, clock_in_at, clock_out_at, worked_seconds, status)
      VALUES (${negocio}, ${emp}, '2026-10-14', '2026-10-14 15:00+00', '2026-10-14 18:00+00', 10800, 'closed')`;

    const corregir = (user: string, entrada: string, salida: string, pausa: number, motivo: string) =>
      asUser(sql, user, (tx) => tx`
        SELECT public.correct_work_session(${olvidada.id}, ${entrada}::timestamptz, ${salida}::timestamptz, ${pausa}, ${motivo})`);

    await expect(corregir(gema, '2026-10-14 09:00+00', '2026-10-14 12:00+00', 0, 'Me olvidé')).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(corregir(admin, '2026-10-14 09:00+00', '2026-10-14 12:00+00', 0, ' ')).rejects.toThrow(/motivo/i);
    await expect(corregir(admin, '2026-10-14 12:00+00', '2026-10-14 09:00+00', 0, 'Olvidó fichar')).rejects.toThrow(/salida/i);
    await expect(corregir(admin, '2026-10-14 09:00+00', '2026-10-14 16:00+00', 0, 'Olvidó fichar')).rejects.toThrow(/solapa/i);
    await expect(corregir(admin, '2026-10-14 09:00+00', '2026-10-14 12:00+00', 4 * 3600, 'Olvidó fichar')).rejects.toThrow(/pausa/i);

    await corregir(admin, '2026-10-14 09:00+00', '2026-10-14 12:00+00', 900, 'Olvidó fichar la salida');
    const [s] = await sql`SELECT * FROM hr_work_sessions WHERE id = ${olvidada.id}`;
    expect(s).toMatchObject({
      status: 'closed',
      needs_review: false,
      worked_seconds: 3 * 3600 - 900,
      break_seconds: 900,
      corrected_by: admin,
      correction_reason: 'Olvidó fichar la salida',
    });
    const [log] = await sql`
      SELECT reason, actor_user_id FROM audit_logs
      WHERE table_name = 'hr_work_sessions' AND record_id = ${olvidada.id} AND action = 'UPDATE'
      ORDER BY created_at DESC LIMIT 1`;
    expect(log).toEqual({ reason: 'Olvidó fichar la salida', actor_user_id: admin });

    // El informe mensual devuelve las dos sesiones del día, con su id y su estado de revisión.
    const informe = await asUser(sql, gema, (tx) => tx`
      SELECT * FROM public.get_employee_monthly_report(${negocio}, ${emp}, 2026, 10)`);
    expect(informe.length).toBe(2);
    expect(informe[0]).toMatchObject({ id: olvidada.id, needs_review: false, correction_reason: 'Olvidó fichar la salida' });

    const otro = await nuevoEmpleado('hugo@ejemplo.test');
    await expect(
      asUser(sql, otro, (tx) => tx`SELECT * FROM public.get_employee_monthly_report(${negocio}, ${emp}, 2026, 10)`),
    ).rejects.toThrow(/permiso/i);
  });
});
