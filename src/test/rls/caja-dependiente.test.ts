// @vitest-environment node
// Caja por dependiente (0033): con dependientes con PIN, abre la caja una persona
// identificada; el turno se desglosa por vendedor y respeta el arqueo a ciegas (0030).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface FilaVendedor {
  employee_id: string | null;
  name: string;
  sales_count: string;
  sales_total: string | null;
  cash_total: string | null;
  refunds_count: string;
  refunds_total: string | null;
  net_total: string | null;
}

describe.skipIf(!RLS_DB_URL)('RLS · caja por dependiente', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let tpv: string; // cuenta con la que está abierto el TPV de la tienda
  let ajeno: string;
  const productos: Record<number, string> = {};
  let empOwner: string;
  let ana: string;

  const sesion = async (employee: string, pin: string) => {
    const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${employee}, ${pin})`);
    expect(r.ok).toBe(true);
    return r.session_id;
  };

  const abrir = (sesionVendedor: string | null, fondo = 50) =>
    asUser(sql, tpv, (tx) => tx<{ id: string }[]>`
      SELECT public.open_register_session(_business_id => ${negocio}, _opening_amount => ${fondo},
        _seller_session_id => ${sesionVendedor}) AS id`);

  const vender = async (caja: string, vendedor: string, precio: number, metodo: 'cash' | 'card') => {
    const base = r2(precio / (1 + IVA / 100));
    const items = [{ product_id: productos[precio], variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: precio, total: precio }];
    const [r] = await asUser(sql, tpv, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => ${metodo},
        _subtotal => ${base}, _tax => ${r2(precio - base)}, _total => ${precio},
        _register_session_id => ${caja}, _seller_session_id => ${vendedor})`);
    return r.sale_id;
  };

  const resumen = (caja: string, sesiones: string[], user = tpv) =>
    asUser(sql, user, (tx) => tx<FilaVendedor[]>`
      SELECT * FROM public.get_register_seller_summary(${caja}, ${sesiones}::uuid[])`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${tpv}, 'staff', true)`;
    // Un artículo por precio: las ventas del test van sin descuento.
    for (const precio of [50, 80, 100]) {
      const [p] = await sql<{ id: string }[]>`
        INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
        VALUES (${negocio}, ${'Zueco ' + precio}, ${precio}, 100, true) RETURNING id`;
      productos[precio] = p.id;
    }
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin dependientes con PIN, la caja se abre como siempre', async () => {
    const [c] = await abrir(null);
    const [fila] = await sql`SELECT opened_by, opened_by_employee_id FROM cash_register_sessions WHERE id = ${c.id}`;
    expect(fila).toEqual({ opened_by: tpv, opened_by_employee_id: null });
    await asUser(sql, owner, (tx) => tx`SELECT public.close_register_session(${c.id}, 50)`);
  });

  it('con dependientes con PIN, abre una persona identificada y queda registrada', async () => {
    const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    empOwner = eo.id;
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${empOwner}, '1111')`);
    const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    ana = a.id;
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '2222')`);

    await expect(abrir(null)).rejects.toThrow(/sesión de vendedor/i);
    const sAna = await sesion(ana, '2222');
    const [c] = await abrir(sAna, 80);
    const [fila] = await sql`SELECT opening_amount::float AS fondo, opened_by_employee_id FROM cash_register_sessions WHERE id = ${c.id}`;
    expect(fila).toEqual({ fondo: 80, opened_by_employee_id: ana });
  });

  it('el desglose por vendedor cuadra y respeta el arqueo a ciegas', async () => {
    const [caja] = await sql<{ id: string }[]>`SELECT id FROM cash_register_sessions WHERE business_id = ${negocio} AND status = 'open'`;
    const sAna = await sesion(ana, '2222');
    const sOwner = await sesion(empOwner, '1111');
    await vender(caja.id, sAna, 100, 'cash');
    await vender(caja.id, sAna, 50, 'card');
    const ventaOwner = await vender(caja.id, sOwner, 80, 'cash');
    // El owner (puede devolver) devuelve su venta en efectivo.
    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${ventaOwner}`;
    await asUser(sql, tpv, (tx) => tx`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${ventaOwner},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, _reason => 'Talla', _refund_method => 'cash',
        _restock => true, _seller_session_id => ${sOwner})`);

    // Con el owner conectado (puede cerrar caja): importes visibles.
    const visible = await resumen(caja.id, [sAna, sOwner]);
    const deAna = visible.find((f) => f.employee_id === ana)!;
    const delOwner = visible.find((f) => f.employee_id === empOwner)!;
    expect(deAna).toMatchObject({ name: 'Ana', sales_count: '2', refunds_count: '0' });
    expect(Number(deAna.sales_total)).toBe(150);
    expect(Number(deAna.cash_total)).toBe(100);
    expect(Number(deAna.net_total)).toBe(150);
    expect(delOwner).toMatchObject({ sales_count: '1', refunds_count: '1' });
    expect(Number(delOwner.sales_total)).toBe(80);
    expect(Number(delOwner.refunds_total)).toBe(80);
    expect(Number(delOwner.net_total)).toBe(0);

    // Solo Ana conectada (no puede cerrar caja): recuentos sí, importes no.
    const aCiegas = await resumen(caja.id, [sAna]);
    expect(aCiegas.find((f) => f.employee_id === ana)).toMatchObject({
      sales_count: '2',
      sales_total: null,
      cash_total: null,
      refunds_total: null,
      net_total: null,
    });

    // Una sesión ajena (de otra cuenta) no da visibilidad.
    await expect(resumen(caja.id, [sOwner], ajeno)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('cerrada la caja, el desglose se ve sin necesidad de sesiones', async () => {
    const [caja] = await sql<{ id: string }[]>`SELECT id FROM cash_register_sessions WHERE business_id = ${negocio} AND status = 'open'`;
    const sOwner = await sesion(empOwner, '1111');
    await asUser(sql, tpv, (tx) => tx`
      SELECT public.close_register_session(_session_id => ${caja.id}, _counted_amount => 180, _notes => null,
        _seller_session_id => ${sOwner}, _authorization_id => null)`);
    const filas = await resumen(caja.id, []);
    expect(filas.every((f) => f.sales_total !== null)).toBe(true);
  });

  it('la migración se puede volver a aplicar', async () => {
    const migracion = join(__dirname, '../../../drizzle/migrations/0033_caja_por_dependiente.sql');
    await sql.unsafe(readFileSync(migracion, 'utf8').replace(/\r\n/g, '\n'));
    const [f] = await sql`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'open_register_session'`;
    expect(f.n).toBe(1);
  });
});
