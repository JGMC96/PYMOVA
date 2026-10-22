// @vitest-environment node
// Compras con recepción (0040): proveedores, compras con líneas y recepciones parciales. Solo
// quien puede ajustar stock. Al recibir: stock de la tienda (si va a la tienda), coste del
// artículo, cola de Shopify con la ubicación y el coste, y cola de Stockagile con la ubicación.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const TIENDA = 'gid://shopify/Location/1';
const MADRID = 'gid://shopify/Location/2';
const ANIO = String(new Date().getFullYear()).slice(2);

interface Linea {
  variant_id?: string | null;
  product_id?: string | null;
  quantity: number;
  unit_cost?: number;
  discount_pct?: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · compras con recepción', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;
  let gestor: string; // personal con permiso de ajustar stock
  let ajeno: string;
  let padre: string;
  let v38: string;
  let v39: string;
  let proveedor: string;

  const guardar = async (lineas: Linea[], opts: { id?: string | null; ubicacion?: string | null; user?: string } = {}) => {
    const [r] = await asUser(sql, opts.user ?? gestor, (tx) => tx<{ order_id: string; order_number: string }[]>`
      SELECT * FROM public.save_purchase_order(${negocio}, ${opts.id ?? null}, ${proveedor}, ${opts.ubicacion === undefined ? TIENDA : opts.ubicacion},
        'FW26', ${'2026-11-15'}, 'Pedido de prueba', ${sql.json(lineas as never)}::jsonb)`);
    return r;
  };

  const lineasDe = async (orden: string) =>
    sql<{ id: string; variant_id: string; product_name: string; qty_ordered: number; qty_received: number }[]>`
      SELECT id, variant_id, product_name, qty_ordered, qty_received FROM purchase_order_items WHERE order_id = ${orden} ORDER BY product_name`;

  const recibir = async (orden: string, lineas: { item_id: string; quantity: number }[], user = gestor) => {
    const [r] = await asUser(sql, user, (tx) => tx<{ id: string }[]>`
      SELECT public.receive_purchase_order(${negocio}, ${orden}, ${sql.json(lineas)}::jsonb, 'Caja 1') AS id`);
    return r.id;
  };

  const stock = async (variante: string) => {
    const [v] = await sql`SELECT stock_quantity, cost_price::float AS coste FROM product_variants WHERE id = ${variante}`;
    return v as { stock_quantity: number; coste: number };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    gestor = await createUser(sql, 'gestor@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await asUser(sql, ajeno, (tx) => tx`SELECT public.create_business('Otra', null)`);
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${staff}, 'staff', true), (${negocio}, ${gestor}, 'staff', true)`;
    const [eg] = await asUser(sql, gestor, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${eg.id}, 10, false, false, false, false, true)`);
    await sql`
      INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
      VALUES (${negocio}, 'prueba.myshopify.com', ${TIENDA}, true)`;
    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${negocio})`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 100, 0, true) RETURNING id`;
    padre = p.id;
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, cost_price, barcode, stock_quantity)
      VALUES (${negocio}, ${padre}, 'T38', 100, 30, 'B38', 5) RETURNING id`;
    v38 = a.id;
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, cost_price, barcode, stock_quantity)
      VALUES (${negocio}, ${padre}, 'T39', 100, 30, 'B39', 3) RETURNING id`;
    v39 = c.id;
    await sql`
      INSERT INTO shopify_inventory_levels (business_id, local_product_id, local_variant_id, inventory_item_gid, location_gid, location_name, available)
      VALUES (${negocio}, ${padre}, ${v38}, 'gid://shopify/InventoryItem/38', ${TIENDA}, 'Tienda Valencia', 5),
             (${negocio}, ${padre}, ${v38}, 'gid://shopify/InventoryItem/38', ${MADRID}, 'Almacén Madrid', 1),
             (${negocio}, ${padre}, ${v39}, 'gid://shopify/InventoryItem/39', ${TIENDA}, 'Tienda Valencia', 3)`;
    const [s] = await asUser(sql, gestor, (tx) => tx<{ id: string }[]>`SELECT public.save_supplier(${negocio}, null, 'Fábrica Elda', 'B12345678') AS id`);
    proveedor = s.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('solo quien puede ajustar stock gestiona proveedores y compras, y las ve', async () => {
    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.save_supplier(${negocio}, null, 'Otro')`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(guardar([{ variant_id: v38, quantity: 1 }], { user: staff })).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(guardar([{ variant_id: v38, quantity: 1 }], { user: ajeno })).rejects.toMatchObject(PERMISO_DENEGADO);
    const orden = await guardar([{ variant_id: v38, quantity: 1 }], { user: owner });
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM purchase_orders`)).toEqual([]);
    expect(await asUser(sql, staff, (tx) => tx`SELECT id FROM suppliers`)).toEqual([]);
    expect(await asUser(sql, ajeno, (tx) => tx`SELECT id FROM purchase_order_items`)).toEqual([]);
    expect((await asUser(sql, gestor, (tx) => tx`SELECT id FROM purchase_orders WHERE id = ${orden.order_id}`)).length).toBe(1);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM purchase_orders`)).rejects.toMatchObject(PERMISO_DENEGADO);
    // Nadie escribe las tablas a mano.
    await expect(
      asUser(sql, owner, (tx) => tx`UPDATE purchase_order_items SET qty_received = 1 WHERE order_id = ${orden.order_id}`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staff, (tx) => tx`SELECT public.receive_purchase_order(${negocio}, ${orden.order_id}, '[]'::jsonb)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    // Ubicaciones del negocio para elegir destino: la de la tienda primero.
    const ubicaciones = await asUser(sql, gestor, (tx) => tx`SELECT * FROM public.get_stock_locations(${negocio})`);
    expect(ubicaciones).toEqual([
      { location_gid: TIENDA, location_name: 'Tienda Valencia', is_default: true },
      { location_gid: MADRID, location_name: 'Almacén Madrid', is_default: false },
    ]);
    expect(await asUser(sql, staff, (tx) => tx`SELECT * FROM public.get_stock_locations(${negocio})`)).toEqual([]);
  });

  it('proveedores sin nombres repetidos', async () => {
    await expect(
      asUser(sql, gestor, (tx) => tx`SELECT public.save_supplier(${negocio}, null, '  fábrica elda ')`),
    ).rejects.toThrow(/Ya hay un proveedor/);
    await expect(asUser(sql, gestor, (tx) => tx`SELECT public.save_supplier(${negocio}, null, '  ')`)).rejects.toThrow(/nombre del proveedor/);
  });

  it('guarda la compra con número propio, valida las líneas y se edita hasta que llega algo', async () => {
    const a = await guardar([{ variant_id: v38, quantity: 4, unit_cost: 40, discount_pct: 10 }, { variant_id: v39, quantity: 2, unit_cost: 40 }]);
    expect(a.order_number).toMatch(new RegExp(`^PC-${ANIO}-\\d{4}$`));
    const b = await guardar([{ variant_id: v39, quantity: 1 }]);
    expect(Number(b.order_number.split('-')[2])).toBe(Number(a.order_number.split('-')[2]) + 1);
    const lineas = await lineasDe(a.order_id);
    expect(lineas.map((l) => [l.product_name, l.qty_ordered])).toEqual([['Zueco · T38', 4], ['Zueco · T39', 2]]);

    await expect(guardar([{ variant_id: v38, quantity: 0 }])).rejects.toThrow(/mayores que 0/);
    await expect(guardar([{ variant_id: v38, quantity: 1 }, { variant_id: v38, quantity: 2 }])).rejects.toThrow(/repetido/);
    await expect(guardar([{ product_id: padre, quantity: 1 }])).rejects.toThrow(/tallas o variantes/);
    await expect(guardar([{ variant_id: v38, quantity: 1 }], { ubicacion: 'gid://shopify/Location/999' })).rejects.toThrow(/ubicación no es de este negocio/);
    await expect(guardar([])).rejects.toThrow(/al menos un artículo/);

    // Editar: sustituye las líneas.
    await guardar([{ variant_id: v38, quantity: 6, unit_cost: 40, discount_pct: 10 }], { id: b.order_id });
    expect((await lineasDe(b.order_id)).map((l) => l.qty_ordered)).toEqual([6]);
    await asUser(sql, gestor, (tx) => tx`SELECT public.set_purchase_order_status(${negocio}, ${b.order_id}, 'ordered')`);
    await asUser(sql, gestor, (tx) => tx`SELECT public.set_purchase_order_status(${negocio}, ${b.order_id}, 'cancelled')`);
    await expect(
      asUser(sql, gestor, (tx) => tx`SELECT public.set_purchase_order_status(${negocio}, ${b.order_id}, 'ordered')`),
    ).rejects.toThrow(/No se puede pasar/);
    await expect(recibir(b.order_id, [{ item_id: (await lineasDe(b.order_id))[0].id, quantity: 1 }])).rejects.toThrow(/cancelada/);
  });

  it('recibir en la tienda sube el stock, el coste y manda a Shopify y Stockagile', async () => {
    const orden = await guardar([{ variant_id: v38, quantity: 4, unit_cost: 40, discount_pct: 10 }, { variant_id: v39, quantity: 2, unit_cost: 40 }]);
    const [l38, l39] = await lineasDe(orden.order_id);
    const antes = await stock(v38);

    const r1 = await recibir(orden.order_id, [{ item_id: l38.id, quantity: 2 }]);
    expect(await stock(v38)).toEqual({ stock_quantity: antes.stock_quantity + 2, coste: 36 });
    const [o1] = await sql`SELECT status FROM purchase_orders WHERE id = ${orden.order_id}`;
    expect(o1.status).toBe('partial');

    const ritems = sql`SELECT id FROM purchase_receipt_items WHERE receipt_id = ${r1}`;
    expect(await sql`
      SELECT delta, reason, location_gid, unit_cost::float AS coste FROM shopify_inventory_pushes WHERE source_id IN (${ritems})`)
      .toEqual([{ delta: 2, reason: 'purchase', location_gid: TIENDA, coste: 36 }]);
    expect(await sql`
      SELECT quantity, reason, location_gid FROM stockagile_stock_moves WHERE source_id IN (${ritems})`)
      .toEqual([{ quantity: 2, reason: 'purchase', location_gid: TIENDA }]);
    expect(await sql`
      SELECT delta, source, reference_id FROM stock_movements WHERE variant_id = ${v38} AND source = 'purchase'`)
      .toEqual([{ delta: 2, source: 'purchase', reference_id: r1 }]);

    await expect(recibir(orden.order_id, [{ item_id: l38.id, quantity: 3 }])).rejects.toThrow(/quedan 2 por recibir/);
    await expect(recibir(orden.order_id, [{ item_id: l38.id, quantity: 1 }, { item_id: l38.id, quantity: 1 }])).rejects.toThrow(/una vez/);
    await expect(guardar([{ variant_id: v38, quantity: 9 }], { id: orden.order_id })).rejects.toThrow(/no se puede editar/);

    await recibir(orden.order_id, [{ item_id: l38.id, quantity: 2 }, { item_id: l39.id, quantity: 2 }]);
    const [o2] = await sql`SELECT status, received_at FROM purchase_orders WHERE id = ${orden.order_id}`;
    expect(o2.status).toBe('received');
    expect(o2.received_at).not.toBeNull();
    expect((await lineasDe(orden.order_id)).map((l) => l.qty_received)).toEqual([4, 2]);
    await expect(recibir(orden.order_id, [{ item_id: l39.id, quantity: 1 }])).rejects.toThrow(/recibida/);
  });

  it('recibir en otra ubicación no toca el stock de la tienda, que no cuenta lo pendiente de allí', async () => {
    const orden = await guardar([{ variant_id: v38, quantity: 3, unit_cost: 50 }], { ubicacion: MADRID });
    const [l] = await lineasDe(orden.order_id);
    const antes = await stock(v38);
    const recibo = await recibir(orden.order_id, [{ item_id: l.id, quantity: 3 }]);
    expect(await stock(v38)).toEqual({ stock_quantity: antes.stock_quantity, coste: 50 });
    const ritems = sql`SELECT id FROM purchase_receipt_items WHERE receipt_id = ${recibo}`;
    expect(await sql`SELECT delta, location_gid FROM shopify_inventory_pushes WHERE source_id IN (${ritems})`)
      .toEqual([{ delta: 3, location_gid: MADRID }]);
    expect(await sql`SELECT location_gid FROM stockagile_stock_moves WHERE source_id IN (${ritems})`)
      .toEqual([{ location_gid: MADRID }]);
    // El stock de la tienda se recalcula con su nivel de Shopify más lo pendiente para la tienda.
    const [pend] = await sql`
      SELECT COALESCE(SUM(delta), 0)::int AS n FROM shopify_inventory_pushes
      WHERE local_variant_id = ${v38} AND status IN ('pending', 'failed') AND (location_gid IS NULL OR location_gid = ${TIENDA})`;
    await sql`SELECT public.recompute_local_stock(${negocio}, null, ${v38}, 'shopify')`;
    expect((await stock(v38)).stock_quantity).toBe(5 + pend.n);
  });
});
