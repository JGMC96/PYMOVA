// @vitest-environment node
// Ventas de tienda y online (0064): quién puede verlas (propietario y quien tenga «Ver ventas»),
// qué se cuenta de la web sin duplicar las ventas de la caja, meses, canal y «Hoy» hasta la misma
// hora del año anterior. Solo lectura.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, asUserAal, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';
import type { LiveSalesReport, SalesChannel } from '@/lib/informes';

const PERMISO_DENEGADO = { code: '42501' };
const NO_VALIDO = { code: '22023' };

describe.skipIf(!RLS_DB_URL)('RLS · ventas de tienda y online (0064)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let ajeno: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let tpv: string; // cuenta de personal sin ficha de persona
  let otroOwner: string;
  let empAdmin: string;
  let empStaff: string;
  let empOwner: string;
  let empSinCuenta: string;
  let empAjeno: string;

  const informe = async (
    user: string,
    desde = '2026-10-01',
    hasta = '2026-10-31',
    canal: SalesChannel = 'all',
    business = negocio,
  ): Promise<LiveSalesReport> =>
    asUser(sql, user, async (tx) => {
      const [r] = await tx<{ r: LiveSalesReport }[]>`
        SELECT public.get_sales_report_v2(${business}, ${desde}::date, ${hasta}::date, ${canal}) AS r`;
      return r.r;
    });

  const puedeVer = (user: string, business = negocio) =>
    asUser(sql, user, async (tx) => {
      const [r] = await tx<{ v: boolean }[]>`SELECT public.can_see_sales(${business}) AS v`;
      return r.v;
    });

  const conceder = (quien: string, empleado: string, si = true, business = negocio) =>
    asUser(sql, quien, (tx) => tx`SELECT public.set_sales_access(${business}, ${empleado}, ${si})`);

  const persona = async (business: string, user: string | null, nombre: string) => {
    const [e] = await sql<{ id: string }[]>`
      INSERT INTO hr_employees (business_id, user_id, display_name, is_active)
      VALUES (${business}, ${user}, ${nombre}, true) RETURNING id`;
    return e.id;
  };

  const miembro = (user: string, role: string) =>
    sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${user}, ${role}, true)`;

  const venta = async (business: string, n: number, total: number, creada: string, gid: string | null = null) => {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO sales (business_id, sale_number, total, payment_method, created_at, shopify_order_gid)
      VALUES (${business}, ${'VTA-' + String(n).padStart(6, '0')}, ${total}, 'card', ${creada}, ${gid})
      RETURNING id`;
    return s.id;
  };

  const ticket = (business: string, id: number, total: number, vendido: string, devolucion = false) =>
    sql`INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, payment_methods)
        VALUES (${business}, ${id}, ${'VT' + id}, ${vendido}, ${total}, ${devolucion}, 'Tarjeta')`;

  let pedidos = 0;
  const pedido = (
    business: string,
    total: number,
    creado: string,
    o: { estado?: string; pago?: string; envio?: number; gid?: string; origen?: string } = {},
  ) => {
    pedidos += 1;
    return sql`
      INSERT INTO online_orders (business_id, order_number, external_id, source, customer_name, customer_email, customer_phone,
                                 status, payment_status, shipping_cost, total, created_at)
      VALUES (${business}, ${'#W' + pedidos}, ${o.gid ?? 'gid://shopify/Order/web' + pedidos}, ${o.origen ?? 'shopify'},
              'Clienta Secreta', 'secreta@ejemplo.test', '600000000', ${o.estado ?? 'shipped'}, ${o.pago ?? 'paid'},
              ${o.envio ?? 0}, ${total}, ${creado})`;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    tpv = await createUser(sql, 'tpv@ejemplo.test');
    otroOwner = await createUser(sql, 'otro@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [x] = await asUser(sql, otroOwner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Ajena', null) AS id`);
    ajeno = x.id;
    await sql`UPDATE businesses SET timezone = 'Europe/Madrid' WHERE id IN (${negocio}, ${ajeno})`;
    await miembro(admin, 'admin');
    await miembro(staff, 'staff');
    await miembro(tpv, 'staff');
    empAdmin = await persona(negocio, admin, 'Adela');
    empStaff = await persona(negocio, staff, 'Sara');
    const [propia] = await sql<{ id: string }[]>`SELECT id FROM hr_employees WHERE business_id = ${negocio} AND user_id = ${owner}`;
    empOwner = propia?.id ?? (await persona(negocio, owner, 'Olga'));
    empSinCuenta = await persona(negocio, null, 'Pepa');
    empAjeno = await persona(ajeno, null, 'De fuera');

    // Tienda, octubre de 2026 y 2025.
    await venta(negocio, 1, 100, '2026-10-10T10:00:00Z');
    const enShopify = await venta(negocio, 2, 50, '2026-10-10T11:00:00Z', 'gid://shopify/Order/caja1');
    await sql`INSERT INTO sale_returns (business_id, sale_id, return_number, total, refund_method, created_at)
              VALUES (${negocio}, ${enShopify}, 'DEV-000001', 20, 'card', '2026-10-12T10:00:00Z')`;
    await ticket(negocio, 1, 80, '2026-10-10T09:00:00Z');
    await ticket(negocio, 2, -25, '2026-10-12T09:00:00Z', true);
    await ticket(negocio, 3, 200, '2025-10-10T09:00:00Z');

    // Web, octubre de 2026 y 2025.
    await pedido(negocio, 120, '2026-10-10T12:00:00Z', { envio: 5 });
    await pedido(negocio, 999, '2026-10-10T12:00:00Z', { estado: 'cancelled' });
    await pedido(negocio, 0, '2026-10-11T12:00:00Z', { estado: 'returned', pago: 'refunded', envio: 4 });
    await pedido(negocio, 30, '2026-10-12T12:00:00Z', { pago: 'refunded' }); // reembolso parcial
    // La venta de la caja copiada como pedido web, con una devolución parcial: no se cuenta otra vez.
    await pedido(negocio, 30, '2026-10-12T13:00:00Z', { pago: 'refunded', gid: 'gid://shopify/Order/caja1' });
    await pedido(negocio, 77, '2026-10-13T12:00:00Z', { pago: 'voided' });
    await pedido(negocio, 10, '2026-09-30T22:30:00Z'); // 00:30 del 1 de octubre en Madrid: entra
    await pedido(negocio, 500, '2026-10-31T23:30:00Z'); // 00:30 del 1 de noviembre en Madrid: no entra en octubre
    await pedido(negocio, 55, '2026-10-14T12:00:00Z', { origen: 'manual' });
    await pedido(negocio, 150, '2025-10-05T12:00:00Z');

    // Otro negocio: no debe colarse.
    await venta(ajeno, 1, 7777, '2026-10-10T10:00:00Z');
    await pedido(ajeno, 8888, '2026-10-10T10:00:00Z');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin permiso solo lo ve el propietario: ni administrador, personal, cuenta del TPV, ajeno ni anónimo', async () => {
    expect(await puedeVer(owner)).toBe(true);
    for (const u of [admin, staff, tpv, otroOwner]) {
      expect(await puedeVer(u)).toBe(false);
      await expect(informe(u)).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    await expect(
      asAnon(sql, (tx) => tx`SELECT public.get_sales_report_v2(${negocio}, '2026-10-01'::date, '2026-10-31'::date)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT public.can_see_sales(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('solo el propietario concede el permiso, y solo a personas del negocio con su cuenta', async () => {
    for (const u of [admin, staff, tpv, otroOwner]) {
      await expect(conceder(u, empStaff)).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    await expect(conceder(owner, empAjeno)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(conceder(otroOwner, empStaff, true, ajeno)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(conceder(owner, empSinCuenta)).rejects.toMatchObject(NO_VALIDO);
    await expect(conceder(owner, empOwner)).rejects.toMatchObject(NO_VALIDO);
    await expect(
      asUser(sql, admin, (tx) => tx`
        INSERT INTO sales_report_access (business_id, employee_id, user_id) VALUES (${negocio}, ${empAdmin}, ${admin})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, admin, (tx) => tx`SELECT * FROM sales_report_access`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, admin, (tx) => tx`SELECT * FROM public.get_sales_access(${negocio})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('con el permiso, administrador y personal ven las cifras, sin las ventas por vendedor y solo de su negocio', async () => {
    await conceder(owner, empAdmin);
    await conceder(owner, empStaff);
    const concedidos = await asUser(sql, owner, (tx) => tx<{ employee_id: string }[]>`SELECT * FROM public.get_sales_access(${negocio})`);
    expect(concedidos.map((c) => c.employee_id).sort()).toEqual([empAdmin, empStaff].sort());

    for (const u of [admin, staff]) {
      const r = await informe(u);
      expect(r.current.net_total).toBe(345);
      expect(r.can_see_sellers).toBe(false);
      expect(r.by_seller).toEqual([]);
      await expect(informe(u, '2026-10-01', '2026-10-31', 'all', ajeno)).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    const dueno = await informe(owner);
    expect(dueno.can_see_sellers).toBe(true);
    expect(dueno.by_seller.length).toBeGreaterThan(0);
    // La cuenta del TPV sigue sin ver nada.
    await expect(informe(tpv)).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('al quitar el permiso deja de ver al momento', async () => {
    await conceder(owner, empStaff, false);
    await expect(informe(staff)).rejects.toMatchObject(PERMISO_DENEGADO);
    expect(await puedeVer(admin)).toBe(true);
  });

  it('la baja de la persona o del miembro borra el permiso, y no revive al volver', async () => {
    await conceder(owner, empStaff);
    await sql`UPDATE hr_employees SET is_active = false WHERE id = ${empStaff}`;
    expect(await puedeVer(staff)).toBe(false);
    await sql`UPDATE hr_employees SET is_active = true WHERE id = ${empStaff}`;
    expect(await puedeVer(staff)).toBe(false);

    await conceder(owner, empStaff);
    await sql`UPDATE business_members SET is_active = false WHERE business_id = ${negocio} AND user_id = ${staff}`;
    expect(await puedeVer(staff)).toBe(false);
    await sql`UPDATE business_members SET is_active = true WHERE business_id = ${negocio} AND user_id = ${staff}`;
    expect(await puedeVer(staff)).toBe(false);
  });

  it('quitar al miembro borra el permiso, y borrar un negocio con permisos concedidos funciona', async () => {
    const lola = await createUser(sql, 'lola@ejemplo.test');
    const [g] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Temporal', null) AS id`);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${g.id}, ${lola}, 'staff', true)`;
    const emp = await persona(g.id, lola, 'Lola');
    await conceder(owner, emp, true, g.id);
    expect(await puedeVer(lola, g.id)).toBe(true);
    await asUser(sql, owner, (tx) => tx`SELECT public.remove_member(${g.id}, ${lola})`);
    expect(await puedeVer(lola, g.id)).toBe(false);
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_report_access WHERE business_id = ${g.id}`;
    expect(n.n).toBe(0);

    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${g.id}, ${lola}, 'staff', true)`;
    await sql`UPDATE hr_employees SET is_active = true WHERE id = ${emp}`;
    await conceder(owner, emp, true, g.id);
    await sql`DELETE FROM businesses WHERE id = ${g.id}`;
    const [quedan] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_report_access WHERE business_id = ${g.id}`;
    expect(quedan.n).toBe(0);
  });

  it('si la ficha pasa a otra cuenta, el permiso no se traspasa', async () => {
    const otraCuenta = await createUser(sql, 'otra-cuenta@ejemplo.test');
    await miembro(otraCuenta, 'admin');
    await conceder(owner, empStaff);
    await sql`UPDATE hr_employees SET user_id = NULL WHERE id = ${empStaff}`;
    await sql`UPDATE hr_employees SET user_id = ${otraCuenta} WHERE id = ${empStaff}`;
    expect(await puedeVer(otraCuenta)).toBe(false);
    expect(await puedeVer(staff)).toBe(false);
  });

  it('con la verificación en dos pasos activada, hace falta el código', async () => {
    await sql`INSERT INTO auth.mfa_factors (user_id, status) VALUES (${admin}, 'verified')`;
    const con = (aal: 'aal1' | 'aal2') =>
      asUserAal(sql, admin, aal, async (tx) => {
        const [r] = await tx<{ v: boolean }[]>`SELECT public.can_see_sales(${negocio}) AS v`;
        return r.v;
      });
    expect(await con('aal1')).toBe(false);
    expect(await con('aal2')).toBe(true);
    await sql`DELETE FROM auth.mfa_factors WHERE user_id = ${admin}`;
  });

  it('suma tienda y web sin cancelados, anulados, otros orígenes ni las ventas de la caja repetidas', async () => {
    const r = await informe(owner);
    expect(r.current).toMatchObject({
      sales_count: 6, // 3 de tienda y 3 de la web
      sales_total: 390,
      returns_count: 2,
      returns_total: 45,
      online_returned_count: 1,
      shipping_total: 5,
      net_total: 345,
    });
    expect(r.prior).toMatchObject({ sales_count: 2, net_total: 350 });
    const canal = (c: string) => r.by_channel.find((x) => x.channel === c);
    expect(canal('store')).toMatchObject({ cur_count: 3, cur_net: 185, prev_net: 200 });
    expect(canal('online')).toMatchObject({ cur_count: 3, cur_net: 160, cur_returned: 1, cur_shipping: 5, prev_net: 150 });
    expect(r.by_payment.reduce((s, p) => s + p.cur_net, 0)).toBe(345);
    expect(r.by_payment.find((p) => p.m === 'web')).toMatchObject({ cur_count: 3, cur_net: 160 });
    expect(r.prior_until).toBeNull();
  });

  it('el filtro Tienda u Online cambia las cifras pero siempre da las dos por separado', async () => {
    const web = await informe(owner, '2026-10-01', '2026-10-31', 'online');
    expect(web.current).toMatchObject({ net_total: 160, sales_count: 3, returns_total: 0 });
    expect(web.by_seller).toEqual([]);
    expect(web.by_payment.map((p) => p.m)).toEqual(['web']);
    expect(web.by_channel.find((x) => x.channel === 'store')).toMatchObject({ cur_net: 185 });
    expect(web.latest.every((l) => l.channel === 'online')).toBe(true);

    const tienda = await informe(owner, '2026-10-01', '2026-10-31', 'store');
    expect(tienda.current).toMatchObject({ net_total: 185, sales_count: 3, online_returned_count: 0 });
    expect(tienda.by_payment.some((p) => p.m === 'web')).toBe(false);
    expect(tienda.latest.every((l) => l.channel === 'store')).toBe(true);
  });

  it('los meses y los días suman el total; en periodos largos no hay tabla por día', async () => {
    const dos = await informe(owner, '2026-09-01', '2026-10-31');
    expect(dos.by_month.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(dos.by_month[1]).toMatchObject({ cur_store: 185, cur_online: 160, prev_store: 200, prev_online: 150, cur_count: 6 });
    expect(dos.by_month.reduce((s, m) => s + m.cur_store + m.cur_online, 0)).toBe(dos.current.net_total);
    expect(dos.by_day).toHaveLength(61);
    expect(dos.by_day.reduce((s, d) => s + d.cur_store + d.cur_online, 0)).toBe(dos.current.net_total);
    expect(dos.by_day.find((d) => d.date === '2026-10-01')).toMatchObject({ cur_online: 10 });

    const anio = await informe(owner, '2026-01-01', '2026-12-31');
    expect(anio.by_day).toEqual([]);
    expect(anio.by_month).toHaveLength(12);
    expect(anio.by_month.reduce((s, m) => s + m.cur_store + m.cur_online, 0)).toBe(anio.current.net_total);
  });

  it('las últimas ventas van de la más nueva a la más antigua y no llevan datos de clientas', async () => {
    const r = await informe(owner);
    expect(r.latest.length).toBeGreaterThan(0);
    expect(r.latest.length).toBeLessThanOrEqual(10);
    expect(r.latest[0]).toMatchObject({ channel: 'online', amount: 500 });
    const horas = r.latest.map((l) => Date.parse(l.at));
    expect(horas).toEqual([...horas].sort((a, b) => b - a));
    expect(r.latest.map((l) => l.amount)).not.toEqual(expect.arrayContaining([999]));
    for (const importe of [999, 77, 55, 8888, 7777]) expect(r.latest.map((l) => l.amount)).not.toContain(importe);
    expect(Object.keys(r.latest[0]).sort()).toEqual(['amount', 'at', 'channel']);
    expect(JSON.stringify(r)).not.toMatch(/secreta|600000000|#W/i);
  });

  it('«Hoy» se compara con el año anterior solo hasta la misma hora', async () => {
    const [g] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Hoy', null) AS id`);
    await sql`UPDATE businesses SET timezone = 'Europe/Madrid' WHERE id = ${g.id}`;
    const [f] = await sql<{ hoy: string; ayer: string; temprano: string; tarde: string }[]>`
      WITH l AS (SELECT (now() AT TIME ZONE 'Europe/Madrid')::date AS hoy)
      SELECT hoy::text, (hoy - 1)::text AS ayer,
             (((hoy - interval '1 year')::date)::timestamp AT TIME ZONE 'Europe/Madrid')::text AS temprano,
             ((((hoy - interval '1 year')::date)::timestamp + interval '23 hours 59 minutes 59 seconds') AT TIME ZONE 'Europe/Madrid')::text AS tarde
      FROM l`;
    await ticket(g.id, 1, 11, f.temprano);
    await ticket(g.id, 2, 13, f.tarde);

    const hoy = await informe(owner, f.hoy, f.hoy, 'all', g.id);
    expect(hoy.prior_until).toMatch(/^\d{2}:\d{2}$/);
    expect(hoy.prior.net_total).toBe(11);
    // Un periodo de varios días compara días completos.
    const dosDias = await informe(owner, f.ayer, f.hoy, 'all', g.id);
    expect(dosDias.prior_until).toBeNull();
    expect(dosDias.prior.net_total).toBe(24);
  });

  it('un periodo sin ventas da ceros; periodo o canal no válidos se rechazan', async () => {
    const vacio = await informe(owner, '2024-01-01', '2024-01-31');
    expect(vacio.current).toMatchObject({ sales_count: 0, net_total: 0, online_returned_count: 0 });
    expect(vacio.by_payment).toEqual([]);
    expect(vacio.by_month).toHaveLength(1);
    await expect(informe(owner, '2026-10-31', '2026-10-01')).rejects.toMatchObject(NO_VALIDO);
    await expect(informe(owner, '2023-01-01', '2026-10-01')).rejects.toMatchObject(NO_VALIDO);
    await expect(informe(owner, '2026-10-01', '2026-10-31', 'otro' as SalesChannel)).rejects.toMatchObject(NO_VALIDO);
  });

  it('rinde con el volumen de una tienda real (10.000 pedidos web, 5.000 tickets y 2.000 ventas, 3 años)', async () => {
    const [g] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Grande', null) AS id`);
    await sql`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, payment_methods)
      SELECT ${g.id}, i, 'VT' || i, timestamptz '2022-06-01' + (i * interval '8 hours'), CASE WHEN i % 10 = 0 THEN -40 ELSE 60 END,
             i % 10 = 0, 'Tarjeta' FROM generate_series(1, 5000) i`;
    await sql`
      INSERT INTO sales (business_id, sale_number, total, payment_method, created_at, shopify_order_gid)
      SELECT ${g.id}, 'VTA-' || lpad(i::text, 6, '0'), 55, 'card', timestamptz '2026-01-01' + (i * interval '3 hours'),
             'gid://shopify/Order/c' || i FROM generate_series(1, 2000) i`;
    await sql`
      INSERT INTO online_orders (business_id, order_number, external_id, source, customer_name, status, payment_status, total, created_at)
      SELECT ${g.id}, '#G' || i, 'gid://shopify/Order/' || i, 'shopify', 'x', 'shipped', 'paid', 100,
             timestamptz '2023-01-01' + (i * interval '3 hours') FROM generate_series(1, 10000) i`;
    await sql`ANALYZE stockagile_sales`;
    await sql`ANALYZE sales`;
    await sql`ANALYZE online_orders`;
    for (const [desde, hasta] of [['2026-10-01', '2026-10-31'], ['2024-01-01', '2026-12-31']]) {
      const t0 = performance.now();
      const r = await informe(owner, desde, hasta, 'all', g.id);
      const ms = performance.now() - t0;
      console.log(`get_sales_report_v2 ${desde} a ${hasta}: ${ms.toFixed(0)} ms`);
      expect(r.current.sales_count).toBeGreaterThan(0);
      expect(ms).toBeLessThan(4000);
    }
  });

  it('la consulta no cambia nada', async () => {
    const foto = () => sql`SELECT (SELECT count(*) FROM sales) AS v, (SELECT count(*) FROM online_orders) AS o,
      (SELECT count(*) FROM stock_movements) AS m, (SELECT count(*) FROM cash_register_sessions) AS c`;
    const antes = await foto();
    await informe(owner);
    expect(await foto()).toEqual(antes);
  });
});
