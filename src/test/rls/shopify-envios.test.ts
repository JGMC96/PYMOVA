// @vitest-environment node
// Envíos del TPV a Shopify: reclamación sin duplicados, trabajo pendiente para la tarea
// programada, y fallos visibles y reintentables solo por administradores.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

describe.skipIf(!RLS_DB_URL)('RLS · envíos del TPV a Shopify', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let numero = 0;

  /** Venta mínima directa en la tabla (como superusuario), lista para enviar a Shopify. */
  const venta = async (extra: Record<string, unknown> = {}) => {
    numero += 1;
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO sales ${sql({
        business_id: negocio,
        sale_number: `VTA-9${String(numero).padStart(5, '0')}`,
        subtotal: 8.26,
        tax: 1.74,
        total: 10,
        payment_method: 'card',
        ...extra,
      } as never)} RETURNING id`;
    return s.id;
  };

  const reclamar = async (limite = 20) => {
    const filas = await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE service_role');
      return tx<{ id: string }[]>`SELECT * FROM public.claim_pos_sales_for_shopify(${negocio}, ${limite}) AS id`;
    });
    return (filas as { id: string }[]).map((f) => f.id).sort();
  };

  const trabajo = async () => {
    const [r] = await sql`SELECT * FROM public.shopify_pending_pos_work()`;
    return r as { pending_orders: boolean; pending_refunds: boolean };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, pos_orders_enabled, pos_orders_since)
      VALUES (${negocio}, 'prueba.myshopify.com', true, now() - interval '1 day')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('sin ventas pendientes no hay trabajo; con una, sí', async () => {
    expect(await trabajo()).toEqual({ pending_orders: false, pending_refunds: false });
    await venta();
    expect((await trabajo()).pending_orders).toBe(true);
  });

  it('cada venta se reclama una sola vez, aunque haya dos envíos a la vez', async () => {
    await venta();
    await venta();
    const [a, b] = await Promise.all([reclamar(), reclamar()]);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect(a.length + b.length).toBe(3);
    const filas = await sql`SELECT shopify_order_status, shopify_order_claimed_at FROM sales WHERE business_id = ${negocio}`;
    expect(filas.every((f) => f.shopify_order_status === 'sending' && f.shopify_order_claimed_at)).toBe(true);
    // Ya reclamadas: un tercer envío no coge nada, y no cuentan como trabajo pendiente.
    expect(await reclamar()).toEqual([]);
    expect((await trabajo()).pending_orders).toBe(false);
  });

  it('una venta que se quedó «enviando» más de 10 minutos se puede volver a reclamar', async () => {
    const id = await venta();
    expect(await reclamar()).toEqual([id]);
    await sql`UPDATE sales SET shopify_order_claimed_at = now() - interval '11 minutes' WHERE id = ${id}`;
    expect((await trabajo()).pending_orders).toBe(true);
    expect(await reclamar()).toEqual([id]);
  });

  it('no se reclaman las ya enviadas, las agotadas, las anteriores a la conexión ni con los pedidos desactivados', async () => {
    await sql`UPDATE sales SET shopify_order_status = 'done', shopify_order_gid = 'gid://shopify/Order/1' WHERE business_id = ${negocio}`;
    await venta({ shopify_order_attempts: 5, shopify_order_status: 'failed' });
    await venta({ created_at: new Date(Date.now() - 3 * 86400000) });
    expect(await reclamar()).toEqual([]);
    const pendiente = await venta();
    await sql`UPDATE shopify_connections SET pos_orders_enabled = false WHERE business_id = ${negocio}`;
    expect(await reclamar()).toEqual([]);
    expect((await trabajo()).pending_orders).toBe(false);
    await sql`UPDATE shopify_connections SET pos_orders_enabled = true WHERE business_id = ${negocio}`;
    expect(await reclamar()).toEqual([pendiente]);
    await sql`UPDATE sales SET shopify_order_status = 'done', shopify_order_gid = 'gid://shopify/Order/2' WHERE id = ${pendiente}`;
  });

  it('una devolución pendiente cuenta solo si su venta ya está en Shopify', async () => {
    const enviada = await venta({ shopify_order_status: 'done', shopify_order_gid: 'gid://shopify/Order/3' });
    const fallida = await venta({ shopify_order_status: 'failed', shopify_order_attempts: 5, shopify_order_error: 'Shopify caído' });
    await sql`
      INSERT INTO sale_returns (business_id, sale_id, return_number, total)
      VALUES (${negocio}, ${fallida}, 'DEV-900001', 10)`;
    expect((await trabajo()).pending_refunds).toBe(false);
    await sql`
      INSERT INTO sale_returns (business_id, sale_id, return_number, total)
      VALUES (${negocio}, ${enviada}, 'DEV-900002', 10)`;
    expect((await trabajo()).pending_refunds).toBe(true);
  });

  it('los fallos los ve y los reintenta solo un administrador', async () => {
    await sql`
      INSERT INTO shopify_inventory_pushes (business_id, delta, reason, status, attempts, last_error)
      VALUES (${negocio}, -1, 'sale', 'failed', 5, 'Sin conexión')`;
    await sql`
      INSERT INTO integration_webhook_events (business_id, integration_key, topic, event_id, status, message, attempts)
      VALUES (${negocio}, 'shopify', 'products/update', 'ev-err', 'error', 'Fallo al leer', 5)`;

    const fallos = await asUser(sql, owner, (tx) => tx`SELECT * FROM public.get_shopify_problems(${negocio})`);
    const porTipo = (k: string) => fallos.filter((f) => f.kind === k);
    expect(porTipo('venta').some((f) => f.state === 'failed' && f.error === 'Shopify caído')).toBe(true);
    expect(porTipo('devolucion').find((f) => f.reference === 'DEV-900001')).toMatchObject({
      state: 'waiting',
      error: expect.stringContaining('Esperando a que se envíe su venta'),
    });
    expect(porTipo('stock')).toHaveLength(1);
    expect(porTipo('aviso')).toHaveLength(1);

    for (const usuario of [staff, ajeno]) {
      await expect(
        asUser(sql, usuario, (tx) => tx`SELECT * FROM public.get_shopify_problems(${negocio})`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(
        asUser(sql, usuario, (tx) => tx`SELECT * FROM public.retry_shopify_problems(${negocio})`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    }
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.get_shopify_problems(${negocio})`)).rejects.toMatchObject(
      PERMISO_DENEGADO,
    );

    const [r] = await asUser(sql, owner, (tx) => tx`SELECT * FROM public.retry_shopify_problems(${negocio})`);
    expect(r).toEqual({ sales_count: 2, returns_count: 0, stock_count: 1, webhooks_count: 1 });
    const [s] = await sql`
      SELECT count(*)::int AS n FROM sales WHERE business_id = ${negocio} AND shopify_order_status = 'failed'`;
    expect(s.n).toBe(0);
    const [q] = await sql`SELECT status, attempts FROM shopify_inventory_pushes WHERE business_id = ${negocio}`;
    expect(q).toEqual({ status: 'pending', attempts: 0 });
    const [e] = await sql`SELECT status, attempts FROM integration_webhook_events WHERE event_id = 'ev-err'`;
    expect(e).toEqual({ status: 'retrying', attempts: 0 });
    // Las ventas reintentadas vuelven a ser trabajo pendiente para la tarea programada.
    expect((await trabajo()).pending_orders).toBe(true);
  });

  it('los clientes no pueden reclamar ventas ni consultar el trabajo pendiente', async () => {
    await expect(
      asUser(sql, owner, (tx) => tx`SELECT * FROM public.claim_pos_sales_for_shopify(${negocio}, 5)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM public.shopify_pending_pos_work()`)).rejects.toMatchObject(
      PERMISO_DENEGADO,
    );
  });

  it('la tarea programada tiene tickets para pedidos y reembolsos del TPV', async () => {
    for (const accion of ['pos-orders', 'pos-refunds']) {
      const [t] = await sql`SELECT public.issue_scheduled_job_ticket(${accion}) AS id`;
      expect(t.id).toBeTruthy();
    }
    await expect(sql`SELECT public.issue_scheduled_job_ticket('inventada')`).rejects.toThrow(/check/i);
  });
});
