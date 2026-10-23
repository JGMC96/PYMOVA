// @vitest-environment node
// Auditoría de seguridad del 23/10/2026 (0051): la conexión con Shopify solo se escribe desde el
// servidor, solo el servicio vincula la tienda (S1) y nadie con sesión encola stock para
// Shopify directamente (S3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const TIENDA = 'tienda.myshopify.com';

describe.skipIf(!RLS_DB_URL)('RLS · Shopify solo desde el servidor (0051)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let atacante: string;
  let negocioAtacante: string;
  let producto: string;
  let variante: string;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    atacante = await createUser(sql, 'atacante@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [x] = await asUser(sql, atacante, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    negocioAtacante = x.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, stock_push_enabled, pos_orders_enabled)
      VALUES (${negocio}, ${TIENDA}, true, true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, track_inventory) VALUES (${negocio}, 'Zueco', 50, true) RETURNING id`;
    producto = p.id;
    const [v] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity)
      VALUES (${negocio}, ${producto}, 'T38', 50, 5) RETURNING id`;
    variante = v.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('nadie crea una conexión por la API, tampoco el owner de otro negocio con un dominio falso', async () => {
    await expect(asUser(sql, atacante, (tx) => tx`
      INSERT INTO shopify_connections (business_id, shop_domain, pos_orders_enabled)
      VALUES (${negocioAtacante}, 'falso.myshopify.com', true)`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`
      INSERT INTO shopify_connections (business_id, shop_domain) VALUES (${negocio}, 'otra.myshopify.com')`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM shopify_connections`;
    expect(n).toBe(1);
  });

  it('ni el owner ni un admin cambian o borran la conexión de su negocio; los miembros la siguen viendo', async () => {
    for (const user of [owner, admin]) {
      await expect(asUser(sql, user, (tx) => tx`
        UPDATE shopify_connections SET shop_domain = 'falso.myshopify.com', pos_orders_enabled = false
        WHERE business_id = ${negocio}`)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(asUser(sql, user, (tx) => tx`DELETE FROM shopify_connections WHERE business_id = ${negocio}`))
        .rejects.toMatchObject(PERMISO_DENEGADO);
    }
    const vistas = await asUser(sql, staff, (tx) => tx<{ shop_domain: string }[]>`
      SELECT shop_domain FROM shopify_connections WHERE business_id = ${negocio}`);
    expect(vistas).toEqual([{ shop_domain: TIENDA }]);
  });

  it('claim_shopify_shop no se ejecuta con sesión de usuario ni sin sesión', async () => {
    await expect(asUser(sql, atacante, (tx) => tx`
      SELECT public.claim_shopify_shop(${negocioAtacante}, 'falso.myshopify.com', '2026-07')`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.claim_shopify_shop(${negocio}, ${TIENDA}, '2026-07')`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT public.claim_shopify_shop(${negocioAtacante}, 'falso.myshopify.com', '2026-07')`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('el servicio vincula la tienda, y una tienda ya vinculada no pasa a otro negocio', async () => {
    await expect(asService(sql, (tx) => tx`SELECT public.claim_shopify_shop(${negocioAtacante}, ${TIENDA}, '2026-07')`))
      .rejects.toThrow('ya está vinculada a otro negocio');
    // La misma tienda para su negocio: devuelve la conexión que ya hay.
    const [mismo] = await asService(sql, (tx) => tx<{ business_id: string }[]>`
      SELECT (public.claim_shopify_shop(${negocio}, ${TIENDA}, '2026-07')).business_id`);
    expect(mismo.business_id).toBe(negocio);

    const nuevo = await createUser(sql, 'nuevo@ejemplo.test');
    const [n] = await asUser(sql, nuevo, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Nueva', null) AS id`);
    const [c] = await asService(sql, (tx) => tx<{ business_id: string; shop_domain: string }[]>`
      SELECT (r).business_id, (r).shop_domain FROM (SELECT public.claim_shopify_shop(${n.id}, 'nueva.myshopify.com', '2026-07') AS r) s`);
    expect(c).toEqual({ business_id: n.id, shop_domain: 'nueva.myshopify.com' });
  });

  it('nadie con sesión encola stock para Shopify directamente (S3)', async () => {
    for (const user of [staff, admin, atacante]) {
      await expect(asUser(sql, user, (tx) => tx`
        SELECT public.enqueue_shopify_inventory_push(${negocio}, ${producto}, ${variante}, -50, 'adjustment', null, null)`))
        .rejects.toMatchObject(PERMISO_DENEGADO);
    }
    await expect(asAnon(sql, (tx) => tx`
      SELECT public.enqueue_shopify_inventory_push(${negocio}, ${producto}, ${variante}, -50, 'adjustment', null, null)`))
      .rejects.toMatchObject(PERMISO_DENEGADO);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM shopify_inventory_pushes`;
    expect(n).toBe(0);
  });

  it('las RPC que sí pueden siguen encolando: un admin ajusta stock y el delta va a la cola', async () => {
    await asUser(sql, admin, (tx) => tx`SELECT public.adjust_stock(${negocio}, ${producto}, ${variante}, 3, 'Recuento')`);
    const cola = await sql<{ delta: number }[]>`
      SELECT delta FROM shopify_inventory_pushes WHERE local_variant_id = ${variante}`;
    expect(cola).toEqual([{ delta: -2 }]);
  });
});
