// @vitest-environment node
// PR 1 de stock: Shopify (Tienda Valencia) manda en el stock de los artículos
// emparejados. Los webhooks de inventario actualizan el stock local; lo que nace
// en Pymova se manda a Shopify por la cola. Historial en stock_movements.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const TIENDA = 'gid://shopify/Location/1';
const MADRID = 'gid://shopify/Location/2';
const I1 = 'gid://shopify/InventoryItem/101';
const I2 = 'gid://shopify/InventoryItem/102';
const I3 = 'gid://shopify/InventoryItem/103';

interface Nivel {
  inventory_item_gid: string;
  location_gid: string;
  available: number;
  updated_at: string;
}

describe.skipIf(!RLS_DB_URL)('RLS · stock desde Shopify y movimientos', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;
  let padre: string;
  let v1: string;
  let v2: string;
  let simple: string;

  const stock = async (tabla: 'products' | 'product_variants', id: string) => {
    const [r] = await sql`SELECT stock_quantity FROM ${sql(tabla)} WHERE id = ${id}`;
    return r.stock_quantity as number;
  };

  const aplicar = (niveles: Nivel[], origen = 'shopify') =>
    sql<{ applied: number; stale: number; unknown: number }[]>`
      SELECT * FROM public.apply_shopify_inventory_levels(${negocio}, ${sql.json(niveles as never)}::jsonb, ${origen})`;

  const movimientos = (id: string) =>
    sql`SELECT delta, stock_after, source FROM stock_movements
        WHERE variant_id = ${id} OR (product_id = ${id} AND variant_id IS NULL) ORDER BY created_at, id`;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    staff = await createUser(sql, 'staff@ejemplo.test');
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
      VALUES (${negocio}, 'prueba.myshopify.com', ${TIENDA}, true)`;

    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 50, 8, true) RETURNING id`;
    padre = p.id;
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${negocio}, ${padre}, 'T38', 50, 5) RETURNING id`;
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${negocio}, ${padre}, 'T39', 50, 3) RETURNING id`;
    v1 = a.id;
    v2 = c.id;
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Calcetín', 6, 4, true) RETURNING id`;
    simple = s.id;

    await sql`
      INSERT INTO shopify_inventory_levels (business_id, local_product_id, local_variant_id, inventory_item_gid, location_gid, available)
      VALUES (${negocio}, ${padre}, ${v1}, ${I1}, ${TIENDA}, 5),
             (${negocio}, ${padre}, ${v1}, ${I1}, ${MADRID}, 2),
             (${negocio}, ${padre}, ${v2}, ${I2}, ${TIENDA}, 3),
             (${negocio}, ${simple}, NULL, ${I3}, ${TIENDA}, 4)`;
    await asUser(sql, owner, (tx) => tx`SELECT public.open_register_session(${negocio}, 0)`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('un cambio en Tienda Valencia actualiza la variante, el producto padre y deja un movimiento', async () => {
    const [r] = await aplicar([{ inventory_item_gid: I1, location_gid: TIENDA, available: 2, updated_at: '2026-10-20T10:00:00Z' }]);
    expect(r.applied).toBe(1);
    expect(await stock('product_variants', v1)).toBe(2);
    expect(await stock('products', padre)).toBe(5); // 2 + 3
    const movs = await movimientos(v1);
    expect(movs.at(-1)).toEqual({ delta: -3, stock_after: 2, source: 'shopify' });
  });

  it('un cambio en Almacén Madrid no toca el stock local', async () => {
    await aplicar([{ inventory_item_gid: I1, location_gid: MADRID, available: 10, updated_at: '2026-10-20T10:01:00Z' }]);
    expect(await stock('product_variants', v1)).toBe(2);
    const [n] = await sql`SELECT available FROM shopify_inventory_levels WHERE inventory_item_gid = ${I1} AND location_gid = ${MADRID}`;
    expect(n.available).toBe(10);
  });

  it('un webhook más antiguo que el último aplicado se ignora; uno desconocido también', async () => {
    const [r] = await aplicar([
      { inventory_item_gid: I1, location_gid: TIENDA, available: 9, updated_at: '2026-10-20T09:00:00Z' },
      { inventory_item_gid: 'gid://shopify/InventoryItem/999', location_gid: TIENDA, available: 9, updated_at: '2026-10-20T11:00:00Z' },
    ]);
    expect(r).toMatchObject({ applied: 0, stale: 1, unknown: 1 });
    expect(await stock('product_variants', v1)).toBe(2);
  });

  it('el eco de una venta del TPV no descuenta dos veces', async () => {
    const items = [{ product_id: padre, variant_id: v1, product_name: 'Zueco · T38', quantity: 1, unit_price: 50, total: 50 }];
    await asUser(sql, staff, (tx) => tx`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => 41.32, _tax => 8.68, _total => 50)`);
    expect(await stock('product_variants', v1)).toBe(1);
    expect((await movimientos(v1)).at(-1)).toMatchObject({ delta: -1, stock_after: 1, source: 'sale' });

    // Llega un webhook de Shopify anterior a que se aplique nuestro envío: Shopify aún tiene 2.
    await aplicar([{ inventory_item_gid: I1, location_gid: TIENDA, available: 2, updated_at: '2026-10-20T10:05:00Z' }]);
    expect(await stock('product_variants', v1)).toBe(1);

    // El envío se aplica en Shopify y llega su eco con 1.
    await sql`UPDATE shopify_inventory_pushes SET status = 'done' WHERE local_variant_id = ${v1} AND status = 'pending'`;
    await sql`UPDATE shopify_inventory_levels SET available = 1 WHERE inventory_item_gid = ${I1} AND location_gid = ${TIENDA}`;
    await aplicar([{ inventory_item_gid: I1, location_gid: TIENDA, available: 1, updated_at: '2026-10-20T10:06:00Z' }]);
    expect(await stock('product_variants', v1)).toBe(1);
  });

  it('un producto sin variantes se actualiza por su nivel y la venta y la devolución dejan movimientos', async () => {
    await aplicar([{ inventory_item_gid: I3, location_gid: TIENDA, available: 6, updated_at: '2026-10-20T10:10:00Z' }]);
    expect(await stock('products', simple)).toBe(6);

    const items = [{ product_id: simple, variant_id: null, product_name: 'Calcetín', quantity: 1, unit_price: 6, total: 6 }];
    const [venta] = await asUser(sql, staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => 4.96, _tax => 1.04, _total => 6)`);
    const [linea] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta.sale_id}`;
    await asUser(sql, staff, (tx) => tx`
      SELECT * FROM public.create_sale_return(${negocio}, ${venta.sale_id}, ${sql.json([{ sale_item_id: linea.id, quantity: 1 }])}::jsonb, 'Talla', 'cash', true)`);

    const fuentes = (await movimientos(simple)).map((m) => m.source);
    expect(fuentes.slice(-3)).toEqual(['shopify', 'sale', 'return']);
    expect(await stock('products', simple)).toBe(6);
  });

  it('los clientes no pueden aplicar niveles ni escribir movimientos', async () => {
    await expect(
      asUser(sql, owner, (tx) => tx`
        SELECT * FROM public.apply_shopify_inventory_levels(${negocio}, '[]'::jsonb, 'shopify')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, owner, (tx) => tx`
        INSERT INTO stock_movements (business_id, product_id, delta, stock_after, source) VALUES (${negocio}, ${simple}, 100, 100, 'manual')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const vistos = await asUser(sql, staff, (tx) => tx`SELECT id FROM stock_movements WHERE business_id = ${negocio}`);
    expect(vistos.length).toBeGreaterThan(0);
  });

  it('cancelar un pedido de Shopify no toca el stock local; uno manual sí, y se manda a Shopify', async () => {
    const pedido = async (source: string, status: string) => {
      const [o] = await sql<{ id: string }[]>`
        INSERT INTO online_orders (business_id, order_number, source, customer_name, status, stock_applied)
        VALUES (${negocio}, ${'WEB-' + source + status}, ${source}, 'Cliente', ${status}::online_order_status, ${status !== 'pending'})
        RETURNING id`;
      await sql`
        INSERT INTO online_order_items (order_id, product_id, variant_id, product_name, quantity, unit_price, total)
        VALUES (${o.id}, ${padre}, ${v2}, 'Zueco · T39', 1, 50, 50)`;
      return o.id;
    };

    const deShopify = await pedido('shopify', 'shipped');
    const antes = await stock('product_variants', v2);
    await asUser(sql, staff, (tx) => tx`SELECT public.set_online_order_status(${deShopify}, 'cancelled')`);
    expect(await stock('product_variants', v2)).toBe(antes);

    const manual = await pedido('manual', 'pending');
    await asUser(sql, staff, (tx) => tx`SELECT public.set_online_order_status(${manual}, 'accepted')`);
    expect(await stock('product_variants', v2)).toBe(antes - 1);
    expect((await movimientos(v2)).at(-1)).toMatchObject({ delta: -1, source: 'online_order' });
    const [cola] = await sql`
      SELECT delta, reason FROM shopify_inventory_pushes WHERE local_variant_id = ${v2} ORDER BY created_at DESC LIMIT 1`;
    expect(cola).toEqual({ delta: -1, reason: 'online_order' });
  });

  it('devolver con reposición un pedido de Shopify manda el +1 a Shopify una sola vez', async () => {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO online_orders (business_id, order_number, source, customer_name, status, stock_applied)
      VALUES (${negocio}, 'WEB-devolucion', 'shopify', 'Cliente', 'delivered', true) RETURNING id`;
    await sql`
      INSERT INTO online_order_items (order_id, product_id, variant_id, product_name, quantity, unit_price, total)
      VALUES (${o.id}, ${padre}, ${v2}, 'Zueco · T39', 1, 50, 50)`;
    const antes = await stock('product_variants', v2);

    const devolver = () => asUser(sql, staff, (tx) => tx`
      SELECT * FROM public.create_online_order_return(${o.id}, 'return', 'Talla', 'card', 50, true)`);
    await devolver();
    expect(await stock('product_variants', v2)).toBe(antes + 1);
    expect((await movimientos(v2)).at(-1)).toMatchObject({ delta: 1, source: 'return' });
    const pushes = () => sql`
      SELECT delta, reason FROM shopify_inventory_pushes WHERE source_table = 'online_order_items' AND reason = 'return'`;
    expect(await pushes()).toEqual([{ delta: 1, reason: 'return' }]);

    await devolver();
    expect(await stock('product_variants', v2)).toBe(antes + 1);
    expect((await pushes()).length).toBe(1);
  });
});
