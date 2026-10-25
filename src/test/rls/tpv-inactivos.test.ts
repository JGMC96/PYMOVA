// @vitest-environment node
// Productos inactivos en Shopify con stock (0053): el TPV los puede vender. La talla tiene que
// estar activa (las inactivas son las borradas en Shopify) y todo tiene que ser del negocio.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Linea {
  product_id: string | null;
  variant_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · venta de productos inactivos en Shopify', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let tpv: string;
  let caja: string;
  let sesionLuis: string;
  let sinTallas: string; // inactivo, sin tallas, con stock
  let conTallas: string; // inactivo, con tallas
  let talla38: string; // activa, con stock
  let tallaBorrada: string; // inactiva (borrada en Shopify)
  let ajeno: string; // inactivo de otro negocio
  let tallaAjena: string;

  const vender = async (items: Linea[]) => {
    const neto = r2(items.reduce((s, i) => s + i.total, 0));
    const base = r2(neto / (1 + IVA / 100));
    const [r] = await asUser(sql, tpv, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => ${base}, _tax => ${r2(neto - base)}, _total => ${neto}, _discount => 0,
        _register_session_id => ${caja}, _seller_session_id => ${sesionLuis})`);
    return r.sale_id;
  };

  const linea = (product_id: string, variant_id: string | null, nombre: string, precio = 100): Linea => ({
    product_id, variant_id, product_name: nombre, quantity: 1, unit_price: precio, total: precio,
  });

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    tpv = await createUser(sql, 'tienda@ejemplo.test');
    const otro = await createUser(sql, 'otro@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [b2] = await asUser(sql, otro, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${tpv}, 'staff', true)`;

    const [p1] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory, is_active)
      VALUES (${negocio}, 'Bolso de verano', 40, 3, true, false) RETURNING id`;
    sinTallas = p1.id;
    const [p2] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, is_active) VALUES (${negocio}, 'Sandalia París Crema', 100, false) RETURNING id`;
    conTallas = p2.id;
    const [v1] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity, is_active)
      VALUES (${negocio}, ${conTallas}, '38', 100, 2, true) RETURNING id`;
    talla38 = v1.id;
    const [v2] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity, is_active)
      VALUES (${negocio}, ${conTallas}, '39', 100, 0, false) RETURNING id`;
    tallaBorrada = v2.id;
    const [p3] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory, is_active)
      VALUES (${b2.id}, 'Ajeno', 50, 5, true, false) RETURNING id`;
    ajeno = p3.id;
    const [v3] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity, is_active)
      VALUES (${b2.id}, ${ajeno}, '40', 50, 5, true) RETURNING id`;
    tallaAjena = v3.id;

    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    const [l] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${negocio}, null, 'Luis') AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${negocio}, ${l.id}, '2222')`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${l.id}, 100, true, true)`);
    const [s] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
      SELECT * FROM public.start_seller_session(${negocio}, ${l.id}, '2222')`);
    expect(s.ok).toBe(true);
    sesionLuis = s.session_id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('vende un producto inactivo sin tallas y descuenta su stock', async () => {
    const venta = await vender([linea(sinTallas, null, 'Bolso de verano', 40)]);
    const [i] = await sql`SELECT product_id, variant_id, product_name FROM sale_items WHERE sale_id = ${venta}`;
    expect(i).toEqual({ product_id: sinTallas, variant_id: null, product_name: 'Bolso de verano' });
    const [p] = await sql`SELECT stock_quantity FROM products WHERE id = ${sinTallas}`;
    expect(p.stock_quantity).toBe(2);
  });

  it('vende la talla activa de un producto inactivo y descuenta la talla', async () => {
    const venta = await vender([linea(conTallas, talla38, 'Sandalia París Crema · 38')]);
    const [i] = await sql`SELECT product_id, variant_id FROM sale_items WHERE sale_id = ${venta}`;
    expect(i).toEqual({ product_id: conTallas, variant_id: talla38 });
    const [v] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${talla38}`;
    expect(v.stock_quantity).toBe(1);
  });

  it('sigue rechazando una talla inactiva (borrada en Shopify)', async () => {
    await expect(vender([linea(conTallas, tallaBorrada, 'Sandalia París Crema · 39')])).rejects.toThrow(
      /no pertenece a este negocio o no está activa/,
    );
  });

  it('sigue rechazando productos y tallas de otro negocio', async () => {
    await expect(vender([linea(ajeno, null, 'Ajeno', 50)])).rejects.toThrow(/no pertenece a este negocio/);
    await expect(vender([linea(ajeno, tallaAjena, 'Ajeno · 40', 50)])).rejects.toThrow(/no pertenece a este negocio/);
    await expect(vender([linea(conTallas, tallaAjena, 'Mezcla', 50)])).rejects.toThrow(/no pertenece a este negocio/);
    const [p] = await sql`SELECT stock_quantity FROM products WHERE id = ${ajeno}`;
    expect(p.stock_quantity).toBe(5);
  });

  it('una venta de un producto inactivo se puede devolver y repone el stock', async () => {
    const venta = await vender([linea(conTallas, talla38, 'Sandalia París Crema · 38')]);
    const [item] = await sql<{ id: string }[]>`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [antes] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${talla38}`;
    await asUser(sql, tpv, (tx) => tx`
      SELECT * FROM public.create_sale_return(
        _business_id => ${negocio}, _sale_id => ${venta},
        _items => ${sql.json([{ sale_item_id: item.id, quantity: 1 }] as never)}::jsonb,
        _reason => 'Talla', _refund_method => 'cash', _restock => true, _seller_session_id => ${sesionLuis})`);
    const [despues] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${talla38}`;
    expect(despues.stock_quantity).toBe(antes.stock_quantity + 1);
  });
});
