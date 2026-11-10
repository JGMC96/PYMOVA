// @vitest-environment node
// 0061: precio anterior de Shopify. Cada línea de venta guarda el del catálogo (solo si es mayor
// que su precio), sin cambiar nada de lo cobrado, y la devolución devuelve lo cobrado.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Linea {
  producto: string;
  variante?: string | null;
  precio: number;
  cantidad?: number;
  neto?: number;
  /** Lo que mande el TPV: el servidor no debe hacerle caso. */
  anterior?: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · precio anterior de Shopify', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let staff: string;
  let negocio: string;
  let botin: string;
  let t36: string;
  let t37: string;
  let zueco: string;

  const vender = async (lineas: Linea[], metodo = 'card') => {
    const items = lineas.map((l) => {
      const cantidad = l.cantidad ?? 1;
      return {
        product_id: l.producto, variant_id: l.variante ?? null, product_name: 'Artículo', quantity: cantidad,
        unit_price: l.precio, total: l.neto ?? r2(l.precio * cantidad),
        ...(l.anterior !== undefined ? { compare_at_price: l.anterior } : {}),
      };
    });
    const total = r2(items.reduce((a, i) => a + i.total, 0));
    const bruto = r2(items.reduce((a, i) => a + i.unit_price * i.quantity, 0));
    const base = r2(total / (1 + IVA / 100));
    const [r] = await asUser(sql, owner, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => ${metodo},
        _subtotal => ${base}, _tax => ${r2(total - base)}, _total => ${total}, _discount => ${r2(bruto - total)})`);
    return r.sale_id;
  };
  const lineas = (venta: string) =>
    sql<{ variant_id: string | null; unit_price: string; total: string; compare_at_price: string | null }[]>`
      SELECT variant_id, unit_price, total, compare_at_price FROM sale_items WHERE sale_id = ${venta} ORDER BY unit_price DESC`;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, track_inventory, stock_quantity) VALUES (${negocio}, 'Botín Cannes Chocolate', 143.2, true, 0) RETURNING id`;
    botin = p.id;
    const v = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, compare_at_price, stock_quantity)
      VALUES (${negocio}, ${botin}, '36', 143.2, 179, 100), (${negocio}, ${botin}, '37', 179, NULL, 100) RETURNING id`;
    [t36, t37] = v.map((x) => x.id);
    const [z] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, compare_at_price, track_inventory, stock_quantity)
      VALUES (${negocio}, 'Zueco sin tallas', 96, 120, true, 10) RETURNING id`;
    zueco = z.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('la migración se puede aplicar otra vez', async () => {
    await sql.unsafe(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0061_0061_precio_anterior.sql'), 'utf8'));
    const venta = await vender([{ producto: botin, variante: t36, precio: 143.2 }]);
    expect(Number((await lineas(venta))[0].compare_at_price)).toBe(179);
  });

  it('cada línea guarda el precio anterior de su talla o de su producto, y lo cobrado no cambia', async () => {
    const antes = await sql<{ s: number }[]>`SELECT stock_quantity AS s FROM product_variants WHERE id = ${t36}`;
    const venta = await vender([
      { producto: botin, variante: t36, precio: 143.2, cantidad: 2 },
      { producto: zueco, precio: 96 },
    ]);
    const [l1, l2] = await lineas(venta);
    expect(l1).toMatchObject({ variant_id: t36, compare_at_price: '179.00' });
    expect(Number(l1.total)).toBe(286.4);
    expect(Number(l2.compare_at_price)).toBe(120);
    expect(Number(l2.total)).toBe(96);
    const [s] = await sql<{ total: string; discount: string }[]>`SELECT total, discount FROM sales WHERE id = ${venta}`;
    expect(Number(s.total)).toBe(382.4);
    expect(Number(s.discount)).toBe(0);
    const despues = await sql<{ s: number }[]>`SELECT stock_quantity AS s FROM product_variants WHERE id = ${t36}`;
    expect(despues[0].s).toBe(antes[0].s - 2);
  });

  it('sin precio anterior, o si no es mayor que el de la línea, queda vacío', async () => {
    const venta = await vender([{ producto: botin, variante: t37, precio: 179 }]);
    expect((await lineas(venta))[0].compare_at_price).toBeNull();
    // Si el precio de la talla sube por encima del anterior, tampoco.
    await sql`UPDATE product_variants SET price = 180 WHERE id = ${t36}`;
    const cara = await vender([{ producto: botin, variante: t36, precio: 180 }]);
    expect((await lineas(cara))[0].compare_at_price).toBeNull();
    await sql`UPDATE product_variants SET price = 143.2 WHERE id = ${t36}`;
  });

  it('el TPV no puede inventarse una rebaja: manda el catálogo', async () => {
    const inventada = await vender([{ producto: botin, variante: t37, precio: 179, anterior: 999 }]);
    expect((await lineas(inventada))[0].compare_at_price).toBeNull();
    const cambiada = await vender([{ producto: botin, variante: t36, precio: 143.2, anterior: 999 }]);
    expect(Number((await lineas(cambiada))[0].compare_at_price)).toBe(179);
  });

  it('un descuento del TPV encima de la rebaja se guarda como siempre', async () => {
    const venta = await vender([{ producto: botin, variante: t36, precio: 143.2, neto: 128.88 }]);
    const [l] = await lineas(venta);
    expect(Number(l.compare_at_price)).toBe(179);
    expect(Number(l.total)).toBe(128.88);
    const [s] = await sql<{ discount: string }[]>`SELECT discount FROM sales WHERE id = ${venta}`;
    expect(Number(s.discount)).toBe(14.32);
  });

  it('al acabar la promoción, las ventas nuevas ya no lo llevan y las antiguas lo conservan', async () => {
    const antigua = await vender([{ producto: zueco, precio: 96 }]);
    await sql`UPDATE products SET compare_at_price = NULL, price = 120 WHERE id = ${zueco}`;
    const nueva = await vender([{ producto: zueco, precio: 120 }]);
    expect(Number((await lineas(antigua))[0].compare_at_price)).toBe(120);
    expect((await lineas(nueva))[0].compare_at_price).toBeNull();
    await sql`UPDATE products SET compare_at_price = 120, price = 96 WHERE id = ${zueco}`;
  });

  it('la devolución devuelve lo cobrado, no el precio anterior', async () => {
    const venta = await vender([{ producto: botin, variante: t36, precio: 143.2 }]);
    const [item] = await sql<{ id: string }[]>`SELECT id FROM sale_items WHERE sale_id = ${venta}`;
    const [d] = await asUser(sql, owner, (tx) => tx<{ return_id: string }[]>`
      SELECT * FROM public.create_sale_return(${negocio}, ${venta}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, 'Talla', 'card', true)`);
    const [r] = await sql<{ total: string }[]>`SELECT total FROM sale_returns WHERE id = ${d.return_id}`;
    expect(Number(r.total)).toBe(143.2);
  });

  it('las columnas se leen con la cuenta del usuario y el coste sigue oculto', async () => {
    const venta = await vender([{ producto: botin, variante: t36, precio: 143.2 }]);
    const [v] = await asUser(sql, staff, (tx) => tx<{ compare_at_price: string }[]>`SELECT compare_at_price FROM product_variants WHERE id = ${t36}`);
    expect(Number(v.compare_at_price)).toBe(179);
    const [p] = await asUser(sql, staff, (tx) => tx<{ compare_at_price: string }[]>`SELECT compare_at_price FROM products WHERE id = ${zueco}`);
    expect(Number(p.compare_at_price)).toBe(120);
    const [l] = await asUser(sql, staff, (tx) => tx<{ compare_at_price: string }[]>`SELECT compare_at_price FROM sale_items WHERE sale_id = ${venta}`);
    expect(Number(l.compare_at_price)).toBe(179);
    await expect(asUser(sql, staff, (tx) => tx`SELECT cost_price FROM product_variants WHERE id = ${t36}`)).rejects.toMatchObject(DENEGADO);
    await expect(asUser(sql, staff, (tx) => tx`SELECT unit_cost FROM sale_items WHERE sale_id = ${venta}`)).rejects.toMatchObject(DENEGADO);
  });

  it('el trigger no lo puede ejecutar la cuenta del usuario, y el anónimo no ve ninguna venta', async () => {
    const [f] = await sql<{ auth: boolean; anon: boolean }[]>`
      SELECT has_function_privilege('authenticated', 'public.sale_item_compare_at_price()', 'EXECUTE') AS auth,
             has_function_privilege('anon', 'public.sale_item_compare_at_price()', 'EXECUTE') AS anon`;
    expect(f).toEqual({ auth: false, anon: false });
    // Puede pedir la columna (regla 0052), pero RLS no le da ninguna venta.
    await expect(asAnon(sql, (tx) => tx`SELECT compare_at_price FROM sale_items`)).resolves.toHaveLength(0);
  });
});
