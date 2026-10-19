// @vitest-environment node
// Ventas, tickets y devoluciones del TPV solo por RPC (A1, A2, A3 y M1 de docs/AUDITORIA.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

interface Negocio {
  id: string;
  owner: string;
  producto: string;
  variante: string;
  cliente: string;
  caja: string;
}

interface Linea {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
}

interface Venta {
  items: Linea[];
  subtotal: number;
  discount?: number;
  tax: number;
  total: number;
  client_id?: string | null;
  register_session_id?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const IVA = 21; // create_business deja tax_rate = 21

describe.skipIf(!RLS_DB_URL)('RLS · TPV: ventas y devoluciones solo por RPC', () => {
  let db: TestDb;
  let sql: Sql;
  let A: Negocio;
  let B: Negocio;
  let staffA: string;
  let adminA: string;
  let superAdmin: string;

  const crearNegocio = async (ownerEmail: string, nombre: string): Promise<Negocio> => {
    const owner = await createUser(sql, ownerEmail);
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${b.id}, 'Zueco', 99, 10, true) RETURNING id`;
    const [v] = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity) VALUES (${b.id}, ${p.id}, 'T38', 99, 10) RETURNING id`;
    const [c] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name) VALUES (${b.id}, 'Cliente') RETURNING id`;
    const [caja] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${b.id}, 50) AS id`);
    return { id: b.id, owner, producto: p.id, variante: v.id, cliente: c.id, caja: caja.id };
  };

  const stock = async (variante: string) => {
    const [r] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${variante}`;
    return r.stock_quantity as number;
  };

  const vender = (userId: string, negocio: string, venta: Venta) =>
    asUser(sql, userId, (tx) => tx`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio},
        _items => ${sql.json(venta.items as never)}::jsonb,
        _payment_method => 'cash',
        _client_id => ${venta.client_id ?? null},
        _subtotal => ${venta.subtotal},
        _tax => ${venta.tax},
        _total => ${venta.total},
        _discount => ${venta.discount ?? 0},
        _register_session_id => ${venta.register_session_id ?? null}
      )`);

  /** Venta de 1 unidad de la variante a 99 € (IVA incluido), con el descuento (%) indicado. */
  const ventaSimple = (n: Negocio, descuentoPct = 0, unitPrice = 99): Venta => {
    const bruto = r2(unitPrice);
    const disc = r2((bruto * descuentoPct) / 100);
    const neto = r2(bruto - disc);
    const base = r2(neto / (1 + IVA / 100));
    return {
      items: [{ product_id: n.producto, variant_id: n.variante, product_name: 'Zueco · T38', quantity: 1, unit_price: unitPrice, total: neto }],
      subtotal: base,
      discount: disc,
      tax: r2(neto - base),
      total: neto,
      client_id: n.cliente,
      register_session_id: n.caja,
    };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    A = await crearNegocio('owner-a@ejemplo.test', 'Tienda A');
    B = await crearNegocio('owner-b@ejemplo.test', 'Tienda B');
    staffA = await createUser(sql, 'staff-a@ejemplo.test');
    adminA = await createUser(sql, 'admin-a@ejemplo.test');
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${A.id}, ${staffA}, 'staff', true), (${A.id}, ${adminA}, 'admin', true)`;
    superAdmin = await createUser(sql, 'super@ejemplo.test');
    await sql`INSERT INTO platform_roles (user_id, role) VALUES (${superAdmin}, 'super_admin')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('una venta correcta se guarda con los importes calculados en el servidor y baja el stock', async () => {
    const antes = await stock(A.variante);
    const venta = ventaSimple(A, 10);
    const [res] = await vender(staffA, A.id, venta);
    expect(res.sale_number).toMatch(/^VTA-/);

    const [s] = await sql`SELECT subtotal::float, discount::float, tax::float, total::float FROM sales WHERE id = ${res.sale_id}`;
    // IVA incluido: el cliente paga 89,10 (99 − 10 %); base 73,64 e IVA 15,46
    expect(s).toEqual({ subtotal: 73.64, discount: 9.9, tax: 15.46, total: 89.1 });
    const [li] = await sql`SELECT unit_price::float, discount::float, total::float, unit_cost FROM sale_items WHERE sale_id = ${res.sale_id}`;
    expect(li).toMatchObject({ unit_price: 99, discount: 9.9, total: 89.1 });
    expect(await stock(A.variante)).toBe(antes - 1);
  });

  it('A11: un artículo de 6 € se cobra a 6 € (IVA incluido), no a 7,26', async () => {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${A.id}, 'Calcetines', 6, 50, true) RETURNING id`;
    const [res] = await vender(staffA, A.id, {
      items: [{ product_id: p.id, variant_id: null, product_name: 'Calcetines', quantity: 1, unit_price: 6, total: 6 }],
      subtotal: 4.96,
      tax: 1.04,
      total: 6,
    });
    const [s] = await sql`SELECT subtotal::float, tax::float, total::float FROM sales WHERE id = ${res.sale_id}`;
    expect(s).toEqual({ subtotal: 4.96, tax: 1.04, total: 6 });
  });

  it('M1: el precio lo pone el catálogo y los totales que no cuadran se rechazan', async () => {
    const antes = await stock(A.variante);
    await expect(vender(staffA, A.id, ventaSimple(A, 0, 1))).rejects.toThrow(/cuadra/i);
    expect(await stock(A.variante)).toBe(antes);

    const inflada = { ...ventaSimple(A), total: 500 };
    await expect(vender(staffA, A.id, inflada)).rejects.toThrow(/cuadra/i);

    const conDescuentoImposible = ventaSimple(A);
    conDescuentoImposible.items[0].total = 120; // neto mayor que el bruto
    await expect(vender(staffA, A.id, conDescuentoImposible)).rejects.toThrow(/descuento|cuadra/i);
  });

  it('A1: no se puede vender con variantes, clientes ni cajas de otro negocio', async () => {
    const stockB = await stock(B.variante);
    const ajena = ventaSimple(A);
    ajena.items[0].variant_id = B.variante;
    ajena.items[0].product_id = B.producto;
    await expect(vender(staffA, A.id, ajena)).rejects.toThrow(/negocio/i);
    expect(await stock(B.variante)).toBe(stockB);

    await expect(vender(staffA, A.id, { ...ventaSimple(A), client_id: B.cliente })).rejects.toThrow(/cliente/i);
    await expect(vender(staffA, A.id, { ...ventaSimple(A), register_session_id: B.caja })).rejects.toThrow(/caja/i);
  });

  it('el trigger de stock rechaza líneas de otro negocio aunque se salte la RLS', async () => {
    const [res] = await vender(staffA, A.id, ventaSimple(A));
    await expect(
      sql`INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, quantity, unit_price, total)
          VALUES (${res.sale_id}, ${B.producto}, ${B.variante}, 'Ajeno', 1, 99, 99)`,
    ).rejects.toThrow(/negocio/i);
  });

  it('A2: los tickets no se pueden editar, crear ni borrar desde el cliente; el super admin sí borra y queda auditado', async () => {
    const [res] = await vender(staffA, A.id, ventaSimple(A));

    const upd = await asUser(sql, staffA, (tx) => tx`UPDATE sale_items SET total = 1 WHERE sale_id = ${res.sale_id}`);
    expect(upd.count).toBe(0);
    const del = await asUser(sql, A.owner, (tx) => tx`DELETE FROM sale_items WHERE sale_id = ${res.sale_id}`);
    expect(del.count).toBe(0);
    await expect(
      asUser(sql, A.owner, (tx) => tx`INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, total) VALUES (${res.sale_id}, 'Extra', 1, 1, 1)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(
      asUser(sql, staffA, (tx) => tx`INSERT INTO sales (business_id, sale_number, total) VALUES (${A.id}, 'VTA-999999', 9999)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const delAdmin = await asUser(sql, adminA, (tx) => tx`DELETE FROM sales WHERE id = ${res.sale_id}`);
    expect(delAdmin.count).toBe(0);

    const delSuper = await asUser(sql, superAdmin, (tx) => tx`DELETE FROM sales WHERE id = ${res.sale_id}`);
    expect(delSuper.count).toBe(1);
    const [aud] = await sql`
      SELECT actor_is_super_admin FROM audit_logs WHERE table_name = 'sales' AND action = 'DELETE' AND record_id = ${res.sale_id}`;
    expect(aud.actor_is_super_admin).toBe(true);
  });

  it('A3: las devoluciones solo se crean con la RPC, reponen stock y no superan lo vendido', async () => {
    const [res] = await vender(staffA, A.id, ventaSimple(A));
    const antes = await stock(A.variante);

    await expect(
      asUser(sql, staffA, (tx) => tx`INSERT INTO sale_returns (business_id, sale_id, return_number, total) VALUES (${A.id}, ${res.sale_id}, 'DEV-999999', 5000)`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);

    const [item] = await sql`SELECT id FROM sale_items WHERE sale_id = ${res.sale_id}`;
    const [dev] = await asUser(sql, staffA, (tx) => tx`
      SELECT * FROM public.create_sale_return(${A.id}, ${res.sale_id}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, 'Talla', 'cash', true)`);
    expect(dev.return_number).toMatch(/^DEV-/);
    expect(await stock(A.variante)).toBe(antes + 1);
    const [tot] = await sql`SELECT total::float FROM sale_returns WHERE id = ${dev.return_id}`;
    expect(tot.total).toBe(99);

    await expect(
      asUser(sql, staffA, (tx) => tx`
        SELECT * FROM public.create_sale_return(${A.id}, ${res.sale_id}, ${sql.json([{ sale_item_id: item.id, quantity: 1 }])}::jsonb, 'Otra vez', 'cash', true)`),
    ).rejects.toThrow(/devolver/i);

    const delAdmin = await asUser(sql, adminA, (tx) => tx`DELETE FROM sale_returns WHERE id = ${dev.return_id}`);
    expect(delAdmin.count).toBe(0);
    const delSuper = await asUser(sql, superAdmin, (tx) => tx`DELETE FROM sale_returns WHERE id = ${dev.return_id}`);
    expect(delSuper.count).toBe(1);
  });
});
