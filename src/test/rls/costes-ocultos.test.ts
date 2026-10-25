// @vitest-environment node
// Costes ocultos en el servidor (0052): la columna de coste no se lee con la cuenta del
// usuario en products, product_variants, sale_items, sale_return_items y
// shopify_inventory_pushes. El coste del catálogo se pide con get_catalog_costs, que exige el
// permiso «Ver costes». Ventas y devoluciones siguen guardando el coste.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tabla y su columna de coste. */
const TABLAS: [string, string][] = [
  ['products', 'cost_price'],
  ['product_variants', 'cost_price'],
  ['sale_items', 'unit_cost'],
  ['sale_return_items', 'unit_cost'],
  ['shopify_inventory_pushes', 'unit_cost'],
];

interface Coste {
  kind: 'product' | 'variant';
  id: string;
  cost_price: string;
}

describe.skipIf(!RLS_DB_URL)('RLS · costes ocultos en el servidor', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otroNegocio: string;
  let owner: string;
  let admin: string;
  let staff: string; // personal sin ficha: permisos del rol
  let encargada: string; // personal con «Ver costes» y «Productos y precios»
  let ajeno: string;
  let producto: string;
  let talla: string;
  let productoAjeno: string;

  const costes = (user: string, negocioId = negocio, productId: string | null = null) =>
    asUser(sql, user, (tx) => tx<Coste[]>`SELECT * FROM public.get_catalog_costs(${negocioId}, ${productId})`);

  const resumen = (filas: Coste[]) => filas.map((f) => [f.kind, f.id, Number(f.cost_price)]);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    encargada = await createUser(sql, 'encargada@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = o.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true), (${negocio}, ${encargada}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, cost_price, stock_quantity, track_inventory)
      VALUES (${negocio}, 'Zueco', 100, 40, 10, true) RETURNING id`;
    producto = p.id;
    const [v] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, cost_price, stock_quantity)
      VALUES (${negocio}, ${producto}, 'T38', 100, 38, 5) RETURNING id`;
    talla = v.id;
    // Un producto sin coste no sale en la lista.
    await sql`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Sin coste', 10)`;
    const [pa] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, cost_price) VALUES (${otroNegocio}, 'Ajeno', 50, 20) RETURNING id`;
    productoAjeno = pa.id;
    const [e] = await asUser(sql, encargada, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    await asUser(sql, owner, (tx) => tx`
      SELECT public.set_employee_permissions(${negocio}, ${e.id}, 10, false, false, true, true, false)`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('nadie lee la columna de coste con su cuenta; el resto de columnas, sí', async () => {
    for (const user of [staff, admin, owner]) {
      for (const [tabla, coste] of TABLAS) {
        await expect(asUser(sql, user, (tx) => tx.unsafe(`SELECT ${coste} FROM public.${tabla} LIMIT 1`))).rejects.toMatchObject(PERMISO_DENEGADO);
        await expect(asUser(sql, user, (tx) => tx.unsafe(`SELECT * FROM public.${tabla} LIMIT 1`))).rejects.toMatchObject(PERMISO_DENEGADO);
      }
    }
    await expect(asAnon(sql, (tx) => tx`SELECT cost_price FROM products`)).rejects.toMatchObject(PERMISO_DENEGADO);
    const filas = await asUser(sql, staff, (tx) => tx`
      SELECT id, name, price::float AS price FROM products WHERE id = ${producto}`);
    expect(filas).toEqual([{ id: producto, name: 'Zueco', price: 100 }]);
    // Embebida como en la app: tallas con su producto.
    const [t] = await asUser(sql, staff, (tx) => tx`
      SELECT v.id, v.name, p.name AS producto FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${talla}`);
    expect(t).toEqual({ id: talla, name: 'T38', producto: 'Zueco' });
  });

  it('get_catalog_costs: solo con «Ver costes» y solo los de su negocio', async () => {
    await expect(costes(staff)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(costes(ajeno)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.get_catalog_costs(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    const esperado = [
      ['product', producto, 40],
      ['variant', talla, 38],
    ];
    for (const user of [owner, admin, encargada]) {
      expect(resumen(await costes(user))).toEqual(esperado);
    }
    // Filtrado por producto, y nunca lo de otro negocio aunque se pida su id.
    expect(resumen(await costes(admin, negocio, producto))).toEqual(esperado);
    expect(await costes(admin, negocio, productoAjeno)).toEqual([]);
    expect(resumen(await costes(ajeno, otroNegocio))).toEqual([['product', productoAjeno, 20]]);
  });

  it('ventas y devoluciones del personal siguen guardando el coste', async () => {
    const items = [{ product_id: producto, variant_id: talla, product_name: 'Zueco T38', quantity: 1, unit_price: 100, total: 100 }];
    const base = r2(100 / (1 + IVA / 100));
    const [venta] = await asUser(sql, staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'card',
        _subtotal => ${base}, _tax => ${r2(100 - base)}, _total => 100, _discount => 0)`);
    const [li] = await sql`SELECT id, unit_cost::float AS coste FROM sale_items WHERE sale_id = ${venta.sale_id}`;
    expect(li.coste).toBe(38);
    // El personal ve su venta, sin el coste.
    const vistas = await asUser(sql, staff, (tx) => tx`
      SELECT product_name, quantity::float AS quantity, total::float AS total FROM sale_items WHERE sale_id = ${venta.sale_id}`);
    expect(vistas).toEqual([{ product_name: 'Zueco T38', quantity: 1, total: 100 }]);

    const [dev] = await asUser(sql, admin, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(_business_id => ${negocio}, _sale_id => ${venta.sale_id},
        _items => ${sql.json([{ sale_item_id: li.id, quantity: 1 }])}::jsonb, _reason => 'Talla', _refund_method => 'card', _restock => true)`);
    const [ri] = await sql`SELECT unit_cost::float AS coste FROM sale_return_items WHERE return_id = ${dev.return_id}`;
    expect(ri.coste).toBe(38);
  });

  it('editar el catálogo sigue funcionando: el precio sin tocar el coste, y el coste con permiso', async () => {
    const precio = await asUser(sql, encargada, (tx) => tx`UPDATE products SET price = 120 WHERE id = ${producto} RETURNING id, price::float AS price`);
    expect(precio).toEqual([{ id: producto, price: 120 }]);
    const [p] = await sql`SELECT price::float AS price, cost_price::float AS coste FROM products WHERE id = ${producto}`;
    expect(p).toEqual({ price: 120, coste: 40 });
    // Guardar el coste (formulario de producto y de talla) no necesita leerlo.
    await asUser(sql, admin, (tx) => tx`UPDATE products SET cost_price = 45 WHERE id = ${producto}`);
    await asUser(sql, admin, (tx) => tx`UPDATE product_variants SET cost_price = 39 WHERE id = ${talla}`);
    const [nuevo] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, cost_price) VALUES (${negocio}, 'Bota', 150, 60) RETURNING id`);
    expect(resumen(await costes(admin, negocio, producto))).toEqual([
      ['product', producto, 45],
      ['variant', talla, 39],
    ]);
    expect(resumen(await costes(admin, negocio, nuevo.id))).toEqual([['product', nuevo.id, 60]]);
    // Sin permiso de catálogo, el personal sigue sin poder cambiar precios ni costes.
    await expect(asUser(sql, staff, (tx) => tx`UPDATE products SET cost_price = 1 WHERE id = ${producto}`)).rejects.toThrow();
  });

  it('guarda: la app puede leer todas las columnas de estas tablas menos el coste', async () => {
    // Si una migración añade una columna a estas tablas sin su GRANT SELECT, falla aquí.
    for (const [tabla, coste] of TABLAS) {
      const cols = await sql<{ column_name: string; auth: boolean; anon: boolean }[]>`
        SELECT column_name,
               has_column_privilege('authenticated', ${'public.' + tabla}, column_name, 'SELECT') AS auth,
               has_column_privilege('anon', ${'public.' + tabla}, column_name, 'SELECT') AS anon
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${tabla}`;
      expect(cols.length).toBeGreaterThan(3);
      for (const c of cols) {
        const visible = c.column_name !== coste;
        expect({ tabla, columna: c.column_name, auth: c.auth, anon: c.anon }).toEqual({
          tabla, columna: c.column_name, auth: visible, anon: visible,
        });
      }
      // El rol de servicio (edge functions) no cambia.
      const [s] = await sql`SELECT has_column_privilege('service_role', ${'public.' + tabla}, ${coste}, 'SELECT') AS ok`;
      expect(s.ok).toBe(true);
    }
  });

  it('la migración 0052 se puede aplicar dos veces', async () => {
    const file = resolve(__dirname, '../../../drizzle/migrations/0052_0052_costes_ocultos.sql');
    await sql.unsafe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    const [g] = await sql`
      SELECT has_function_privilege('anon', 'public.get_catalog_costs(uuid, uuid)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.get_catalog_costs(uuid, uuid)', 'EXECUTE') AS auth,
             has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') AS coste,
             has_column_privilege('authenticated', 'public.products', 'price', 'SELECT') AS precio`;
    expect(g).toEqual({ anon: false, auth: true, coste: false, precio: true });
  });
});
