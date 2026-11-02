// @vitest-environment node
// 0059: gastos, entradas de cambio y retiradas de caja. Solo por RPC y con la caja abierta, con
// el PIN de alguien que pueda cerrar la caja, sin sacar más de lo que hay, y el arqueo los cuenta.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };
const NO_VALIDO = { code: '22023' };

interface Movimiento {
  tipo?: string;
  importe?: number;
  categoria?: string | null;
  motivo?: string;
  autorizacion?: string | null;
}

describe.skipIf(!RLS_DB_URL)('RLS · movimientos de caja', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let admin: string;
  let staff: string;
  let ajeno: string;
  let negocio: string;

  const abrirCaja = async (business: string, fondo = 100) => {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO cash_register_sessions (business_id, status, opening_amount, opened_by)
      VALUES (${business}, 'open', ${fondo}, ${owner}) RETURNING id`;
    return c.id;
  };
  const cerrarDirecto = (caja: string) => sql`UPDATE cash_register_sessions SET status = 'closed', closed_at = now() WHERE id = ${caja}`;
  const apuntar = (user: string, caja: string, m: Movimiento = {}) =>
    asUser(sql, user, (tx) => tx<{ id: string }[]>`
      SELECT public.create_cash_movement(
        ${caja}, ${m.tipo ?? 'expense'}, ${m.importe ?? 3}, ${m.categoria === undefined ? 'drinks' : m.categoria},
        ${m.motivo ?? 'Agua para la tienda'}, ${m.autorizacion ?? null}) AS id`).then((r) => r[0].id);
  const anular = (user: string, movimiento: string, motivo = 'Importe equivocado', autorizacion: string | null = null) =>
    asUser(sql, user, (tx) => tx`SELECT public.void_cash_movement(${movimiento}, ${motivo}, ${autorizacion})`);
  const esperado = async (caja: string) => {
    const [r] = await sql<{ e: string }[]>`SELECT public.register_expected_cash(${caja}) AS e`;
    return Number(r.e);
  };
  const cerrar = async (caja: string, contado: number, user = owner) => {
    await asUser(sql, user, (tx) => tx`SELECT public.close_register_session(${caja}, ${contado}, null)`);
    const [c] = await sql<{ expected_amount: string; difference: string }[]>`
      SELECT expected_amount, difference FROM cash_register_sessions WHERE id = ${caja}`;
    return { esperado: Number(c.expected_amount), diferencia: Number(c.difference) };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Sin PIN', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    await asUser(sql, ajeno, (tx) => tx`SELECT public.create_business('Ajeno', null)`);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('la migración se puede aplicar otra vez sin romper nada', async () => {
    const migracion = readFileSync(resolve(process.cwd(), 'drizzle/migrations/0059_0059_caja_movimientos.sql'), 'utf8');
    await sql.unsafe(migracion);
    const caja = await abrirCaja(negocio, 10);
    await apuntar(owner, caja, { importe: 1 });
    await expect(cerrar(caja, 9)).resolves.toEqual({ esperado: 9, diferencia: 0 });
  });

  describe('arqueo', () => {
    it('gastos y retiradas restan, las entradas suman, y el cierre lo guarda', async () => {
      const caja = await abrirCaja(negocio, 100);
      await apuntar(owner, caja, { tipo: 'expense', importe: 3.5, categoria: 'cleaning', motivo: 'Lejía' });
      await apuntar(owner, caja, { tipo: 'cash_in', importe: 20, categoria: null, motivo: 'Cambio del banco' });
      await apuntar(owner, caja, { tipo: 'withdrawal', importe: 50, categoria: null, motivo: 'Ingreso en el banco' });
      expect(await esperado(caja)).toBe(66.5);
      await expect(cerrar(caja, 66.5)).resolves.toEqual({ esperado: 66.5, diferencia: 0 });
    });

    it('sin movimientos, la cuenta es la de siempre', async () => {
      const caja = await abrirCaja(negocio, 40);
      await expect(cerrar(caja, 39)).resolves.toEqual({ esperado: 40, diferencia: -1 });
    });

    it('un cierre ya guardado no cambia aunque se añadan datos después', async () => {
      const caja = await abrirCaja(negocio, 40);
      await cerrar(caja, 40);
      await sql`INSERT INTO cash_movements (business_id, register_session_id, movement_type, amount, reason) VALUES (${negocio}, ${caja}, 'withdrawal', 5, 'Prueba directa')`;
      const [c] = await sql<{ expected_amount: string }[]>`SELECT expected_amount FROM cash_register_sessions WHERE id = ${caja}`;
      expect(Number(c.expected_amount)).toBe(40);
    });
  });

  describe('quién puede, sin dependientes con PIN', () => {
    it('propietario y administrador sí, y queda quién lo hizo', async () => {
      const caja = await abrirCaja(negocio);
      const id = await apuntar(admin, caja);
      await apuntar(owner, caja);
      const [m] = await sql<{ created_by: string; employee_id: string | null }[]>`SELECT created_by, employee_id FROM cash_movements WHERE id = ${id}`;
      expect(m).toEqual({ created_by: admin, employee_id: null });
      await cerrar(caja, 94);
    });

    it('personal, otro negocio y anónimo no', async () => {
      const caja = await abrirCaja(negocio);
      await expect(apuntar(staff, caja)).rejects.toMatchObject(DENEGADO);
      await expect(apuntar(ajeno, caja)).rejects.toMatchObject(DENEGADO);
      await expect(asAnon(sql, (tx) => tx`SELECT public.create_cash_movement(${caja}, 'expense', 3, 'drinks', 'Agua', null)`)).rejects.toMatchObject(DENEGADO);
      const id = await apuntar(owner, caja);
      await expect(anular(staff, id)).rejects.toMatchObject(DENEGADO);
      await expect(anular(ajeno, id)).rejects.toMatchObject(DENEGADO);
      await cerrar(caja, 97);
    });

    it('nadie escribe directamente en la tabla, ni el propietario', async () => {
      const caja = await abrirCaja(negocio);
      const id = await apuntar(owner, caja);
      await expect(asUser(sql, owner, (tx) => tx`
        INSERT INTO cash_movements (business_id, register_session_id, movement_type, amount, reason)
        VALUES (${negocio}, ${caja}, 'cash_in', 5, 'Directo')`)).rejects.toMatchObject(DENEGADO);
      await expect(asUser(sql, owner, (tx) => tx`UPDATE cash_movements SET amount = 1 WHERE id = ${id}`)).rejects.toMatchObject(DENEGADO);
      await expect(asUser(sql, owner, (tx) => tx`DELETE FROM cash_movements WHERE id = ${id}`)).rejects.toMatchObject(DENEGADO);
      await cerrar(caja, 97);
    });

    it('las funciones internas no se pueden llamar', async () => {
      const caja = await abrirCaja(negocio);
      await expect(asUser(sql, owner, (tx) => tx`SELECT public.register_expected_cash(${caja})`)).rejects.toMatchObject(DENEGADO);
      await expect(asUser(sql, owner, (tx) => tx`SELECT public.cash_movement_actor(${negocio}, null)`)).rejects.toMatchObject(DENEGADO);
      await cerrar(caja, 100);
    });
  });

  describe('lectura', () => {
    it('los miembros ven los de su negocio; otro negocio y anónimo, no', async () => {
      const caja = await abrirCaja(negocio);
      const id = await apuntar(owner, caja);
      const propias = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`SELECT id FROM cash_movements WHERE id = ${id}`);
      expect(propias).toHaveLength(1);
      const ajenas = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT id FROM cash_movements WHERE id = ${id}`);
      expect(ajenas).toHaveLength(0);
      await expect(asAnon(sql, (tx) => tx`SELECT id FROM cash_movements`)).rejects.toMatchObject(DENEGADO);

      const lista = await asUser(sql, staff, (tx) => tx<{ id: string; who: string; reason: string }[]>`SELECT * FROM public.get_cash_movements(${caja})`);
      expect(lista.map((m) => m.id)).toEqual([id]);
      expect(lista[0].who).toBeTruthy();
      await expect(asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.get_cash_movements(${caja})`)).rejects.toMatchObject(DENEGADO);
      await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.get_cash_movements(${caja})`)).rejects.toMatchObject(DENEGADO);
      await cerrar(caja, 97);
    });
  });

  describe('qué se puede apuntar', () => {
    it.each<[string, Movimiento]>([
      ['importe cero', { importe: 0 }],
      ['importe negativo', { importe: -5 }],
      ['más de dos decimales', { importe: 1.234 }],
      ['tipo desconocido', { tipo: 'regalo' }],
      ['gasto sin categoría', { categoria: null }],
      ['categoría desconocida', { categoria: 'viajes' }],
      ['categoría en una entrada', { tipo: 'cash_in' }],
      ['categoría en una retirada', { tipo: 'withdrawal' }],
      ['motivo muy corto', { motivo: ' a ' }],
      ['motivo muy largo', { motivo: 'x'.repeat(201) }],
    ])('rechaza: %s', async (_nombre, m) => {
      const caja = await abrirCaja(negocio, 100);
      await expect(apuntar(owner, caja, m)).rejects.toMatchObject(NO_VALIDO);
      await cerrarDirecto(caja);
    });

    it('limpia los espacios del motivo', async () => {
      const caja = await abrirCaja(negocio, 100);
      const id = await apuntar(owner, caja, { motivo: '  Fregona  ', importe: 1 });
      const [m] = await sql<{ reason: string }[]>`SELECT reason FROM cash_movements WHERE id = ${id}`;
      expect(m.reason).toBe('Fregona');
      await cerrarDirecto(caja);
    });

    it('con la caja cerrada, no', async () => {
      const cerrada = await abrirCaja(negocio);
      await cerrar(cerrada, 100);
      await expect(apuntar(owner, cerrada)).rejects.toMatchObject(NO_VALIDO);
    });

    it('no deja sacar más efectivo del que hay; meter, sí', async () => {
      const otra = await abrirCaja(negocio, 10);
      await expect(apuntar(owner, otra, { importe: 10.01 })).rejects.toMatchObject(NO_VALIDO);
      await expect(apuntar(owner, otra, { tipo: 'withdrawal', categoria: null, importe: 300 })).rejects.toMatchObject(NO_VALIDO);
      await apuntar(owner, otra, { tipo: 'cash_in', categoria: null, importe: 300 });
      await apuntar(owner, otra, { tipo: 'withdrawal', categoria: null, importe: 310 });
      expect(await esperado(otra)).toBe(0);
      await cerrarDirecto(otra);
    });

    it('el aviso de que no hay efectivo no dice cuánto hay', async () => {
      const otra = await abrirCaja(negocio, 12.34);
      await expect(apuntar(owner, otra, { importe: 50 })).rejects.toSatisfy((e: Error) => !/12[.,]34/.test(e.message));
      await cerrarDirecto(otra);
    });
  });

  describe('anular', () => {
    it('deja de contar, queda a la vista con motivo y no se anula dos veces', async () => {
      const caja = await abrirCaja(negocio, 100);
      const id = await apuntar(owner, caja, { importe: 30 });
      expect(await esperado(caja)).toBe(70);
      await anular(admin, id, 'Era de otra caja');
      expect(await esperado(caja)).toBe(100);

      const [m] = await asUser(sql, owner, (tx) => tx<{ voided_at: Date; void_reason: string; voided_who: string; amount: string }[]>`
        SELECT * FROM public.get_cash_movements(${caja})`);
      expect(m.voided_at).toBeTruthy();
      expect(m.void_reason).toBe('Era de otra caja');
      expect(m.voided_who).toBeTruthy();
      expect(Number(m.amount)).toBe(30);

      await expect(anular(owner, id)).rejects.toMatchObject(NO_VALIDO);
      await expect(cerrar(caja, 100)).resolves.toEqual({ esperado: 100, diferencia: 0 });
    });

    it('pide motivo', async () => {
      const caja = await abrirCaja(negocio);
      const id = await apuntar(owner, caja);
      await expect(anular(owner, id, ' x ')).rejects.toMatchObject(NO_VALIDO);
      await cerrarDirecto(caja);
    });

    it('con la caja cerrada, no, y sus cifras no cambian', async () => {
      const caja = await abrirCaja(negocio, 100);
      const id = await apuntar(owner, caja, { importe: 30 });
      await cerrar(caja, 70);
      await expect(anular(owner, id)).rejects.toMatchObject(NO_VALIDO);
      expect(await esperado(caja)).toBe(70);
    });

    it('una entrada ya gastada no se puede anular', async () => {
      const caja = await abrirCaja(negocio, 0);
      const entrada = await apuntar(owner, caja, { tipo: 'cash_in', categoria: null, importe: 50 });
      await apuntar(owner, caja, { tipo: 'withdrawal', categoria: null, importe: 40 });
      await expect(anular(owner, entrada)).rejects.toMatchObject(NO_VALIDO);
      const [m] = await sql<{ voided_at: Date | null }[]>`SELECT voided_at FROM cash_movements WHERE id = ${entrada}`;
      expect(m.voided_at).toBeNull();
      await cerrarDirecto(caja);
    });

    it('un id que no existe no dice nada', async () => {
      await expect(anular(owner, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject(DENEGADO);
    });
  });

  describe('con dependientes con PIN: cada movimiento lleva el PIN de quien puede cerrar caja', () => {
    let conPin: string;
    let tpv: string; // cuenta de personal compartida
    let empOwner: string;
    let luis: string; // encargado con permiso de cerrar caja
    let ana: string; // dependienta sin permiso

    const autorizar = async (employee: string, pin: string, accion = 'cash_movement', user = tpv) => {
      const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; error: string | null; authorization_id: string | null }[]>`
        SELECT * FROM public.authorize_action(${conPin}, ${employee}, ${pin}, ${accion}, null)`);
      return r;
    };

    beforeAll(async () => {
      tpv = await createUser(sql, 'tienda@ejemplo.test');
      const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Con PIN', null) AS id`);
      conPin = b.id;
      await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${conPin}, ${tpv}, 'staff', true)`;
      const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${conPin}) AS id`);
      empOwner = eo.id;
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${empOwner}, '9999')`);
      const [l] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Luis', null) AS id`);
      luis = l.id;
      const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Ana', null) AS id`);
      ana = a.id;
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${luis}, '2222')`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${ana}, '1111')`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${conPin}, ${luis}, 10, false, true, false, false, false)`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${conPin}, ${ana}, 10, true, false, false, false, true)`);
    });

    it('sin PIN no se apunta, ni siendo propietario', async () => {
      const caja = await abrirCaja(conPin);
      await expect(apuntar(owner, caja)).rejects.toMatchObject(DENEGADO);
      await expect(apuntar(tpv, caja)).rejects.toMatchObject(DENEGADO);
      await cerrarDirecto(caja);
    });

    it('quien no puede cerrar caja no puede autorizarlo, aunque tenga otros permisos', async () => {
      const r = await autorizar(ana, '1111');
      expect(r.ok).toBe(false);
      expect(r.authorization_id).toBeNull();
    });

    it('un PIN incorrecto no da autorización', async () => {
      const r = await autorizar(luis, '0000');
      expect(r.ok).toBe(false);
      expect(r.authorization_id).toBeNull();
    });

    it('con el PIN de quien puede, se apunta desde la cuenta del TPV y queda su nombre', async () => {
      const caja = await abrirCaja(conPin);
      const { authorization_id } = await autorizar(luis, '2222');
      const id = await apuntar(tpv, caja, { autorizacion: authorization_id });
      const [m] = await sql<{ employee_id: string; created_by: string }[]>`SELECT employee_id, created_by FROM cash_movements WHERE id = ${id}`;
      expect(m).toEqual({ employee_id: luis, created_by: tpv });
      const [l] = await asUser(sql, tpv, (tx) => tx<{ who: string }[]>`SELECT who FROM public.get_cash_movements(${caja})`);
      expect(l.who).toBe('Luis');
      await cerrarDirecto(caja);
    });

    it('el propietario también pone su PIN', async () => {
      const caja = await abrirCaja(conPin);
      const { authorization_id } = await autorizar(empOwner, '9999', 'cash_movement', owner);
      const id = await apuntar(owner, caja, { autorizacion: authorization_id });
      const [m] = await sql<{ employee_id: string }[]>`SELECT employee_id FROM cash_movements WHERE id = ${id}`;
      expect(m.employee_id).toBe(empOwner);
      await cerrarDirecto(caja);
    });

    it('la autorización vale una vez, y no sirve la de otra acción ni la de otra cuenta', async () => {
      const caja = await abrirCaja(conPin);
      const { authorization_id } = await autorizar(luis, '2222');
      await apuntar(tpv, caja, { autorizacion: authorization_id });
      await expect(apuntar(tpv, caja, { autorizacion: authorization_id })).rejects.toMatchObject(DENEGADO);

      const deCierre = await autorizar(luis, '2222', 'close_register');
      await expect(apuntar(tpv, caja, { autorizacion: deCierre.authorization_id })).rejects.toMatchObject(DENEGADO);

      const deOtraCuenta = await autorizar(luis, '2222', 'cash_movement', owner);
      await expect(apuntar(tpv, caja, { autorizacion: deOtraCuenta.authorization_id })).rejects.toMatchObject(DENEGADO);
      await cerrarDirecto(caja);
    });

    it('si el movimiento no es válido, la autorización sigue sin gastar', async () => {
      const caja = await abrirCaja(conPin);
      const { authorization_id } = await autorizar(luis, '2222');
      await expect(apuntar(tpv, caja, { importe: 0, autorizacion: authorization_id })).rejects.toMatchObject(NO_VALIDO);
      await apuntar(tpv, caja, { autorizacion: authorization_id });
      await cerrarDirecto(caja);
    });

    it('anular también lleva PIN, y queda quién anuló', async () => {
      const caja = await abrirCaja(conPin);
      const primera = await autorizar(luis, '2222');
      const id = await apuntar(tpv, caja, { autorizacion: primera.authorization_id });
      await expect(anular(tpv, id)).rejects.toMatchObject(DENEGADO);
      await expect(anular(owner, id)).rejects.toMatchObject(DENEGADO);

      const segunda = await autorizar(empOwner, '9999', 'cash_movement', owner);
      await anular(owner, id, 'Importe equivocado', segunda.authorization_id);
      const [m] = await sql<{ voided_by_employee_id: string; voided_by: string }[]>`SELECT voided_by_employee_id, voided_by FROM cash_movements WHERE id = ${id}`;
      expect(m).toEqual({ voided_by_employee_id: empOwner, voided_by: owner });
      const [l] = await asUser(sql, tpv, (tx) => tx<{ voided_who: string }[]>`SELECT voided_who FROM public.get_cash_movements(${caja})`);
      expect(l.voided_who).toBeTruthy();
      await cerrarDirecto(caja);
    });

    it('una autorización de este negocio no sirve en otro', async () => {
      const { authorization_id } = await autorizar(luis, '2222', 'cash_movement', owner);
      const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otro con PIN', null) AS id`);
      const [e] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${b.id}) AS id`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${b.id}, ${e.id}, '9999')`);
      const otra = await abrirCaja(b.id);
      await expect(apuntar(owner, otra, { autorizacion: authorization_id })).rejects.toMatchObject(DENEGADO);
      await cerrarDirecto(otra);
    });
  });
});
