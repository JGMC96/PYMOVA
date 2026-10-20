// @vitest-environment node
// PR 2 de stock (A12): los ajustes manuales solo los hacen admins, con motivo,
// por la RPC adjust_stock; quedan en stock_movements y se mandan a Shopify.
// El stock no se puede cambiar escribiendo directamente en las tablas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const TIENDA = 'gid://shopify/Location/1';
const ITEM = 'gid://shopify/InventoryItem/201';

describe.skipIf(!RLS_DB_URL)('RLS · ajustes manuales de stock', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let padre: string;
  let variante: string;
  let suelto: string;

  const ajustar = (user: string, cantidad: number, motivo: string, opts: { producto?: string; variante?: string | null } = {}) =>
    asUser(sql, user, (tx) => tx<{ delta: number }[]>`
      SELECT public.adjust_stock(${negocio}, ${opts.producto ?? padre}, ${opts.variante === undefined ? variante : opts.variante},
        ${cantidad}, ${motivo}) AS delta`);

  const stock = async (tabla: 'products' | 'product_variants', id: string) => {
    const [r] = await sql`SELECT stock_quantity FROM ${sql(tabla)} WHERE id = ${id}`;
    return r.stock_quantity as number;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
      VALUES (${negocio}, 'prueba.myshopify.com', ${TIENDA}, true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, track_inventory) VALUES (${negocio}, 'Zueco', 50, true) RETURNING id`;
    padre = p.id;
    const [v] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${negocio}, ${padre}, 'T38', 50, 5) RETURNING id`;
    variante = v.id;
    await sql`
      INSERT INTO shopify_inventory_levels (business_id, local_product_id, local_variant_id, inventory_item_gid, location_gid, available)
      VALUES (${negocio}, ${padre}, ${variante}, ${ITEM}, ${TIENDA}, 5)`;
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Calcetín', 6, 10, true) RETURNING id`;
    suelto = s.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('un admin ajusta con motivo: queda el movimiento y el delta va a la cola de Shopify', async () => {
    const [r] = await ajustar(admin, 3, 'Recuento');
    expect(r.delta).toBe(-2);
    expect(await stock('product_variants', variante)).toBe(3);
    expect(await stock('products', padre)).toBe(3);

    const [m] = await sql`
      SELECT delta, stock_after, source, note, created_by FROM stock_movements WHERE variant_id = ${variante} ORDER BY created_at DESC LIMIT 1`;
    expect(m).toEqual({ delta: -2, stock_after: 3, source: 'manual', note: 'Recuento', created_by: admin });
    const [cola] = await sql`
      SELECT delta, reason, status FROM shopify_inventory_pushes WHERE local_variant_id = ${variante} ORDER BY created_at DESC LIMIT 1`;
    expect(cola).toEqual({ delta: -2, reason: 'adjustment', status: 'pending' });

    // Si Shopify todavía no lo ha aplicado, un webhook con el valor anterior no lo deshace.
    await sql`
      SELECT * FROM public.apply_shopify_inventory_levels(${negocio},
        ${sql.json([{ inventory_item_gid: ITEM, location_gid: TIENDA, available: 5, updated_at: '2026-10-20T12:00:00Z' }] as never)}::jsonb, 'shopify')`;
    expect(await stock('product_variants', variante)).toBe(3);
  });

  it('el owner ajusta un producto sin variantes; ajustar a la misma cantidad no hace nada', async () => {
    const [r] = await ajustar(owner, 12, 'Entrada de mercancía', { producto: suelto, variante: null });
    expect(r.delta).toBe(2);
    expect(await stock('products', suelto)).toBe(12);
    const [igual] = await ajustar(owner, 12, 'Recuento', { producto: suelto, variante: null });
    expect(igual.delta).toBe(0);
    const [n] = await sql`SELECT count(*)::int AS n FROM stock_movements WHERE product_id = ${suelto} AND source = 'manual'`;
    expect(n.n).toBe(1);
  });

  it('el staff no ajusta, y las entradas inválidas se rechazan', async () => {
    await expect(ajustar(staff, 1, 'Recuento')).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(ajustar(admin, 1, '  ')).rejects.toThrow(/motivo/i);
    await expect(ajustar(admin, -1, 'Rotura')).rejects.toThrow(/negativ/i);
    await expect(ajustar(admin, 1, 'Recuento', { producto: padre, variante: null })).rejects.toThrow(/variante/i);
    const ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    await expect(ajustar(ajeno, 1, 'Recuento')).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  it('nadie cambia el stock escribiendo directamente en las tablas', async () => {
    await expect(
      asUser(sql, admin, (tx) => tx`UPDATE product_variants SET stock_quantity = 99 WHERE id = ${variante}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE products SET stock_quantity = 99 WHERE id = ${suelto}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    // Otros campos sí se pueden editar.
    const ok = await asUser(sql, staff, (tx) => tx`UPDATE products SET description = 'Nuevo' WHERE id = ${suelto}`);
    expect(ok.count).toBe(1);
  });

  it('crear un artículo con stock inicial: el admin sí (queda como alta), el staff solo con 0', async () => {
    const [nuevo] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity)
      VALUES (${negocio}, ${padre}, 'T40', 50, 4) RETURNING id`);
    const [m] = await sql`SELECT source, delta FROM stock_movements WHERE variant_id = ${nuevo.id}`;
    expect(m).toEqual({ source: 'initial', delta: 4 });

    await expect(
      asUser(sql, staff, (tx) => tx`
        INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${negocio}, ${padre}, 'T41', 50, 7)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    const sinStock = await asUser(sql, staff, (tx) => tx`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${negocio}, ${padre}, 'T42', 50, 0)`);
    expect(sinStock.count).toBe(1);
  });

  it('las ventas siguen moviendo el stock aunque el cliente no pueda escribirlo', async () => {
    await asUser(sql, owner, (tx) => tx`SELECT public.open_register_session(${negocio}, 0)`);
    const items = [{ product_id: suelto, variant_id: null, product_name: 'Calcetín', quantity: 1, unit_price: 6, total: 6 }];
    await asUser(sql, staff, (tx) => tx`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'cash',
        _subtotal => 4.96, _tax => 1.04, _total => 6)`);
    expect(await stock('products', suelto)).toBe(11);
  });
});
