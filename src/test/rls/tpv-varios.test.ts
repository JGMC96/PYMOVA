// @vitest-environment node
// «Varios» en el TPV (0038): línea libre, sin producto del catálogo, con descripción y precio
// escritos a mano. Sin stock: no descuenta, no repone, no va a la cola de stock de Shopify
// ni a Stockagile. El descuento sigue el máximo de quien vende.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Linea {
  product_id?: string | null;
  variant_id?: string | null;
  custom?: boolean;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · Varios en el TPV', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let tpv: string;
  let producto: string;
  let caja: string;
  let ana: string; // dependienta: 10 % de descuento máximo
  let sesionLuis: string; // encargado: todo

  const vender = async (items: Linea[], sesion: string | null = sesionLuis, autorizacion: string | null = null) => {
    const bruto = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const neto = r2(items.reduce((s, i) => s + i.total, 0));
    const base = r2(neto / (1 + IVA / 100));
    const [r] = await asUser(sql, tpv, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => ${base}, _tax => ${r2(neto - base)}, _total => ${neto}, _discount => ${r2(bruto - neto)},
        _register_session_id => ${caja}, _seller_session_id => ${sesion}, _authorization_id => ${autorizacion})`);
    return r.sale_id;
  };

  const sesion = async (employee: string, pin: string) => {
    const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${employee}, ${pin})`);
    expect(r.ok).toBe(true);
    return r.session_id;
  };

  const varios = (nombre: string, precio: number, cantidad = 1, total = precio * cantidad): Linea => ({
    product_id: null, variant_id: null, custom: true, product_name: nombre, quantity: cantidad, unit_price: precio, total,
  });

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${tpv}, 'staff', true)`;
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
      VALUES (${negocio}, 'prueba.myshopify.com', 'gid://shopify/Location/1', true)`;
    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${negocio})`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 100, 10, true) RETURNING id`;
    producto = p.id;
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Ana') AS id`);
    ana = a.id;
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${ana}, '1111')`);
    const [l] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Luis') AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${l.id}, '2222')`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${l.id}, 100, true, true)`);
    sesionLuis = await sesion(l.id, '2222');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('vende una línea libre con su descripción y su precio, junto a un artículo del catálogo', async () => {
    const venta = await vender([
      { product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, total: 100 },
      varios('  Bolso outlet  ', 30, 2, 50),
    ]);
    const lineas = await sql`
      SELECT product_id, variant_id, product_name, quantity::float AS quantity, unit_price::float AS unit_price,
             discount::float AS discount, total::float AS total, unit_cost
      FROM sale_items WHERE sale_id = ${venta} ORDER BY total`;
    expect(lineas).toEqual([
      { product_id: null, variant_id: null, product_name: 'Varios · Bolso outlet', quantity: 2, unit_price: 30, discount: 10, total: 50, unit_cost: null },
      { product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: 100, discount: 0, total: 100, unit_cost: null },
    ]);
    // Si el TPV ya manda «Varios · », no se repite.
    const otra = await vender([varios('Varios · Gorro', 8)]);
    const [g] = await sql`SELECT product_name FROM sale_items WHERE sale_id = ${otra}`;
    expect(g.product_name).toBe('Varios · Gorro');
    const [s] = await sql`SELECT total::float AS total, discount::float AS discount FROM sales WHERE id = ${venta}`;
    expect(s).toEqual({ total: 150, discount: 10 });
    // El artículo del catálogo descuenta stock; la línea libre, no.
    const [p] = await sql`SELECT stock_quantity FROM products WHERE id = ${producto}`;
    expect(p.stock_quantity).toBe(9);
    // A la cola de stock de Shopify solo va el artículo del catálogo.
    const cola = await sql`
      SELECT local_product_id, delta FROM shopify_inventory_pushes
      WHERE source_table = 'sale_items' AND source_id IN (SELECT id FROM sale_items WHERE sale_id = ${venta})`;
    expect(cola).toEqual([{ local_product_id: producto, delta: -1 }]);
  });

  it('no deja una línea libre sin descripción, sin precio o con un precio absurdo', async () => {
    await expect(vender([varios('   ', 10)])).rejects.toThrow(/Escribe qué se vende/);
    await expect(vender([varios('Bolso', 0)])).rejects.toThrow(/precio de "Bolso"/);
    await expect(vender([varios('Bolso', -5)])).rejects.toThrow(/precio de "Bolso"/);
    await expect(vender([varios('Bolso', 100000)])).rejects.toThrow(/precio de "Bolso"/);
    await expect(vender([varios('x'.repeat(121), 10)])).rejects.toThrow(/120 caracteres/);
    await expect(vender([varios('Varios · ', 10)])).rejects.toThrow(/Escribe qué se vende/);
    // Sin la marca de línea libre, sigue haciendo falta un producto del catálogo.
    await expect(
      vender([{ product_id: null, variant_id: null, product_name: 'Bolso', quantity: 1, unit_price: 10, total: 10 }]),
    ).rejects.toThrow(/producto del catálogo/);
    // Con producto, manda el precio del catálogo aunque llegue la marca.
    await expect(
      vender([{ product_id: producto, custom: true, product_name: 'Zueco', quantity: 1, unit_price: 1, total: 1 }]),
    ).rejects.toThrow(/no cuadra/);
  });

  it('el descuento de una línea libre respeta el máximo de quien vende', async () => {
    const sAna = await sesion(ana, '1111');
    await vender([varios('Muestra', 40, 1, 36)], sAna); // 10 %: dentro del máximo
    await expect(vender([varios('Muestra', 40, 1, 20)], sAna)).rejects.toThrow(/Necesita autorización/);
  });

  it('al devolverla no repone stock ni va a Shopify ni a Stockagile', async () => {
    const venta = await vender([varios('Cinturón', 25)]);
    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [r] = await asUser(sql, tpv, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${venta},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, _reason => 'No le va', _refund_method => 'cash',
        _restock => true, _seller_session_id => ${sesionLuis})`);
    const [dev] = await sql`SELECT total::float AS total FROM sale_returns WHERE id = ${r.return_id}`;
    expect(dev.total).toBe(25);
    const ids = sql`SELECT id FROM sale_return_items WHERE return_id = ${r.return_id}`;
    expect(await sql`SELECT 1 FROM shopify_inventory_pushes WHERE source_table = 'sale_return_items' AND source_id IN (${ids})`).toEqual([]);
    expect(await sql`SELECT 1 FROM stockagile_stock_moves WHERE source_table = 'sale_return_items' AND source_id IN (${ids})`).toEqual([]);
  });
});
