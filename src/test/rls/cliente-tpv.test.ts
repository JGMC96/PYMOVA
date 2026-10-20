// @vitest-environment node
// Cliente en la venta del TPV (0034): quien cobra busca y da de alta clientes con lo
// mínimo y apunta si aceptan el ticket por correo, aunque desde la 0030 solo los
// administradores editen clientes. Con dependientes con PIN hace falta una sesión.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const DATO_NO_VALIDO = { code: '22023' };

interface Alta {
  client_id: string;
  name: string;
  email: string | null;
  receipt_email_consent: boolean;
  created: boolean;
}

describe.skipIf(!RLS_DB_URL)('RLS · cliente en el TPV', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let tpv: string; // cuenta con rol personal con la que está abierto el TPV
  let ajeno: string;
  let producto: string;

  const alta = (
    user: string,
    datos: { nombre?: string | null; correo?: string | null; telefono?: string | null; acepta?: boolean },
    sesionVendedor: string | null = null,
  ) =>
    asUser(sql, user, (tx) => tx<Alta[]>`
      SELECT * FROM public.pos_find_or_create_client(
        _business_id => ${negocio}, _name => ${datos.nombre ?? null}, _email => ${datos.correo ?? null},
        _phone => ${datos.telefono ?? null}, _receipt_consent => ${datos.acepta ?? false},
        _seller_session_id => ${sesionVendedor})`).then((r) => r[0]);

  const buscar = (user: string, q: string) =>
    asUser(sql, user, (tx) => tx<{ id: string; name: string }[]>`
      SELECT * FROM public.pos_search_clients(${negocio}, ${q})`);

  const vender = async () => {
    const items = [{ product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, total: 100 }];
    const [r] = await asUser(sql, tpv, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'card',
        _subtotal => 82.64, _tax => 17.36, _total => 100)`);
    return r.sale_id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${tpv}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
      VALUES (${negocio}, 'Zueco', 100, 100, true) RETURNING id`;
    producto = p.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el personal no puede crear clientes directamente, pero sí con el alta del TPV', async () => {
    await expect(asUser(sql, tpv, (tx) => tx`
      INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Directo')`)).rejects.toMatchObject(PERMISO_DENEGADO);

    const c = await alta(tpv, { nombre: '  Lucía Pérez ', correo: ' Lucia@Correo.ES ', telefono: '+34 600 111 222', acepta: true });
    expect(c).toMatchObject({ name: 'Lucía Pérez', email: 'lucia@correo.es', receipt_email_consent: true, created: true });
    const [fila] = await sql`
      SELECT notes, created_by, receipt_email_consent_at IS NOT NULL AS con_fecha FROM clients WHERE id = ${c.client_id}`;
    expect(fila).toEqual({ notes: 'Alta desde el TPV', created_by: tpv, con_fecha: true });
  });

  it('reutiliza el cliente con el mismo correo o teléfono sin tocar sus datos', async () => {
    const porCorreo = await alta(tpv, { nombre: 'Otro nombre', correo: 'LUCIA@correo.es' });
    expect(porCorreo).toMatchObject({ name: 'Lucía Pérez', created: false });

    const sinCorreo = await alta(tpv, { nombre: 'Marta', telefono: '611 222 333' });
    expect(sinCorreo.created).toBe(true);
    // El mismo teléfono con otro formato: completa el correo y apunta el consentimiento.
    const otra = await alta(tpv, { nombre: 'Marta G.', correo: 'marta@correo.es', telefono: '611-222-333', acepta: true });
    expect(otra).toMatchObject({
      client_id: sinCorreo.client_id, name: 'Marta', email: 'marta@correo.es', receipt_email_consent: true, created: false,
    });
    // Ese teléfono con otro correo distinto: no se mezcla con otra persona.
    await expect(alta(tpv, { nombre: 'X', correo: 'otra@correo.es', telefono: '611222333' }))
      .rejects.toMatchObject(DATO_NO_VALIDO);
  });

  it('valida el correo y exige correo para aceptar el ticket por correo', async () => {
    await expect(alta(tpv, { nombre: 'Sin arroba', correo: 'no-es-correo' })).rejects.toMatchObject(DATO_NO_VALIDO);
    await expect(alta(tpv, { nombre: 'Sin correo', acepta: true })).rejects.toMatchObject(DATO_NO_VALIDO);
    await expect(alta(tpv, { nombre: '   ' })).rejects.toMatchObject(DATO_NO_VALIDO);
  });

  it('busca por nombre, correo o teléfono y trata los comodines como texto', async () => {
    expect((await buscar(tpv, 'lucía')).map((c) => c.name)).toEqual(['Lucía Pérez']);
    expect((await buscar(tpv, 'marta@')).map((c) => c.name)).toEqual(['Marta']);
    expect((await buscar(tpv, '222 333')).map((c) => c.name)).toEqual(['Marta']);
    expect(await buscar(tpv, '%%')).toEqual([]);
    expect(await buscar(tpv, 'l')).toEqual([]);
  });

  it('nadie de fuera del negocio busca, da de alta ni cambia consentimientos', async () => {
    await expect(buscar(ajeno, 'lucía')).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(alta(ajeno, { nombre: 'Intruso' })).rejects.toMatchObject(PERMISO_DENEGADO);
    const [c] = await sql<{ id: string }[]>`SELECT id FROM clients WHERE email = 'lucia@correo.es'`;
    await expect(asUser(sql, ajeno, (tx) => tx`SELECT public.pos_set_receipt_consent(${c.id}, false)`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    for (const anon of ['pos_search_clients', 'pos_find_or_create_client', 'pos_set_receipt_consent', 'pos_set_sale_client']) {
      const [r] = await sql<{ ok: boolean }[]>`
        SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok
        FROM pg_proc p WHERE p.proname = ${anon} AND p.pronamespace = 'public'::regnamespace`;
      expect(r.ok).toBe(false);
    }
  });

  it('apunta o retira el consentimiento de un cliente que ya existe', async () => {
    const sinPermiso = await alta(owner, { nombre: 'Pedro', correo: 'pedro@correo.es' });
    expect(sinPermiso.receipt_email_consent).toBe(false);
    await asUser(sql, tpv, (tx) => tx`SELECT public.pos_set_receipt_consent(${sinPermiso.client_id}, true)`);
    let [f] = await sql`SELECT receipt_email_consent FROM clients WHERE id = ${sinPermiso.client_id}`;
    expect(f.receipt_email_consent).toBe(true);
    await asUser(sql, tpv, (tx) => tx`SELECT public.pos_set_receipt_consent(${sinPermiso.client_id}, false)`);
    [f] = await sql`SELECT receipt_email_consent FROM clients WHERE id = ${sinPermiso.client_id}`;
    expect(f.receipt_email_consent).toBe(false);
    // No cambia un correo que ya tiene.
    await expect(asUser(sql, tpv, (tx) => tx`
      SELECT public.pos_set_receipt_consent(${sinPermiso.client_id}, true, 'otro@correo.es')`))
      .rejects.toMatchObject(DATO_NO_VALIDO);
  });

  it('pone el cliente a una venta cobrada, pero solo un administrador lo cambia por otro', async () => {
    const venta = await vender();
    const [lucia] = await sql<{ id: string }[]>`SELECT id FROM clients WHERE email = 'lucia@correo.es'`;
    const [pedro] = await sql<{ id: string }[]>`SELECT id FROM clients WHERE email = 'pedro@correo.es'`;
    await asUser(sql, tpv, (tx) => tx`SELECT public.pos_set_sale_client(${venta}, ${lucia.id})`);
    let [s] = await sql`SELECT client_id FROM sales WHERE id = ${venta}`;
    expect(s.client_id).toBe(lucia.id);

    await expect(asUser(sql, tpv, (tx) => tx`SELECT public.pos_set_sale_client(${venta}, ${pedro.id})`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    await asUser(sql, owner, (tx) => tx`SELECT public.pos_set_sale_client(${venta}, ${pedro.id})`);
    [s] = await sql`SELECT client_id FROM sales WHERE id = ${venta}`;
    expect(s.client_id).toBe(pedro.id);

    // Un cliente de otro negocio no vale.
    const [otro] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    const [extra] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name) VALUES (${otro.id}, 'Ajena') RETURNING id`;
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.pos_set_sale_client(${venta}, ${extra.id})`))
      .rejects.toThrow(/Cliente no encontrado/);
  });

  it('con dependientes con PIN, el alta pide una sesión de vendedor', async () => {
    const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${a.id}, '2222')`);

    await expect(alta(tpv, { nombre: 'Sin sesión' })).rejects.toMatchObject(PERMISO_DENEGADO);
    const [s] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${a.id}, '2222')`);
    const c = await alta(tpv, { nombre: 'Con sesión' }, s.session_id);
    expect(c.created).toBe(true);
  });
});
