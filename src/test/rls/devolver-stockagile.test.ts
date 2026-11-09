// @vitest-environment node
// 0060: devolver tickets de Stockagile desde PYMOVA. Tope por lo comprado menos lo devuelto en
// los dos sistemas, enlace por ticket y artículo, un solo +1 en cada cola, y caja, vale y
// permisos como una devolución normal.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };
const NO_VALIDO = { code: '22023' };
const TIENDA = 'Tienda Valencia';

interface Linea {
  nombre: string;
  codigo?: string | null;
  cantidad?: number;
  total: number;
  talla?: string | null;
  variante?: string | null;
}
interface Item {
  line_key: string;
  quantity: number;
  variant_id?: string | null;
}
interface Articulo {
  line_key: string;
  product_name: string;
  quantity: number;
  line_total: string;
  returned_stockagile: number;
  returned_pymova: number;
  remaining: number;
  variant_id: string | null;
  variant_match: string | null;
  variant_name: string | null;
}
interface Devolucion {
  blocked: string | null;
  over_returned: boolean;
  lines: Articulo[];
}

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

describe.skipIf(!RLS_DB_URL)('RLS · devolver tickets de Stockagile', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let negocio: string;
  let otro: string;
  let producto: string;
  let t39: string;
  let t40: string;
  let externo = 1000;

  const CODIGO_39 = '9600000000017';
  const CODIGO_40 = '9600000000024';

  const ticket = async (lineas: Linea[], o: {
    negocio?: string; almacen?: string | null; fecha?: string; deleted?: boolean; devuelveA?: number | null; cliente?: string | null;
  } = {}) => {
    externo += 1;
    const [s] = await sql<{ id: string; external_id: string }[]>`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, warehouse_name, total, is_return, return_of_external_id, deleted, payment_methods, client_id)
      VALUES (${o.negocio ?? negocio}, ${externo}, ${'VT' + externo}, ${o.fecha ?? hace(5)}, ${o.almacen === undefined ? TIENDA : o.almacen},
              ${lineas.reduce((a, l) => a + l.total, 0)}, ${o.devuelveA != null}, ${o.devuelveA ?? null}, ${o.deleted ?? false}, 'Tarjeta', ${o.cliente ?? null})
      RETURNING id, external_id`;
    for (const l of lineas) {
      const cantidad = l.cantidad ?? 1;
      await sql`
        INSERT INTO stockagile_sale_items (sale_id, product_name, size, barcode, quantity, unit_price, total, variant_id)
        VALUES (${s.id}, ${l.nombre}, ${l.talla ?? null}, ${l.codigo ?? null}, ${cantidad}, ${l.total / (cantidad || 1)}, ${l.total}, ${l.variante ?? null})`;
    }
    return { id: s.id, external: Number(s.external_id) };
  };
  const zueco39 = (o: Partial<Linea> = {}): Linea => ({
    nombre: 'Zueco Bolonia Negro - 39', codigo: CODIGO_39, total: 149, talla: '39', variante: t39, ...o,
  });
  const clave = (codigo: string) => `b:${codigo}`;

  const consultar = async (venta: string, user = owner, business = negocio) =>
    (await asUser(sql, user, (tx) => tx<{ r: Devolucion }[]>`SELECT public.get_stockagile_returnable(${business}, ${venta}) AS r`))[0].r;
  const devolver = (venta: string, items: Item[], o: {
    user?: string; metodo?: string | null; restock?: boolean; sesion?: string | null; autorizacion?: string | null; business?: string;
  } = {}) =>
    asUser(sql, o.user ?? owner, (tx) => tx<{ return_id: string; return_number: string }[]>`
      SELECT * FROM public.create_stockagile_return(
        _business_id => ${o.business ?? negocio}, _sale_id => ${venta}, _items => ${sql.json(items as never)}::jsonb,
        _reason => 'Talla', _refund_method => ${o.metodo === undefined ? 'store_credit' : o.metodo}, _restock => ${o.restock ?? true},
        _seller_session_id => ${o.sesion ?? null}, _authorization_id => ${o.autorizacion ?? null})`).then((r) => r[0]);
  const item39 = (cantidad = 1): Item => ({ line_key: clave(CODIGO_39), quantity: cantidad, variant_id: t39 });
  const stock = async (variante: string) =>
    Number((await sql<{ s: number }[]>`SELECT stock_quantity AS s FROM product_variants WHERE id = ${variante}`)[0].s);
  const colas = async (devolucion: string) => {
    const [r] = await sql<{ shopify: string; stockagile: string; misma: boolean }[]>`
      WITH i AS (SELECT id FROM sale_return_items WHERE return_id = ${devolucion}),
           p AS (SELECT source_id, delta FROM shopify_inventory_pushes WHERE source_table = 'sale_return_items' AND source_id IN (SELECT id FROM i)),
           m AS (SELECT source_id, quantity FROM stockagile_stock_moves WHERE source_table = 'sale_return_items' AND source_id IN (SELECT id FROM i))
      SELECT (SELECT COALESCE(sum(delta), 0) FROM p)::text AS shopify, (SELECT COALESCE(sum(quantity), 0) FROM m)::text AS stockagile,
             NOT EXISTS (SELECT source_id FROM p EXCEPT SELECT source_id FROM m) AS misma`;
    return { shopify: Number(r.shopify), stockagile: Number(r.stockagile), misma: r.misma };
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
    const [o] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Ajeno', null) AS id`);
    otro = o.id;
    await sql`INSERT INTO stockagile_connections (business_id, enabled, returns_warehouse_name) VALUES (${negocio}, true, ${TIENDA})`;
    await sql`INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
              VALUES (${negocio}, 'tienda.myshopify.com', 'gid://shopify/Location/1', true)`;
    const [p] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Zueco Bolonia Negro', 149) RETURNING id`;
    producto = p.id;
    const v = await sql<{ id: string }[]>`
      INSERT INTO product_variants (business_id, product_id, name, attributes, barcode, stock_quantity)
      VALUES (${negocio}, ${producto}, '39', '{"Talla":"39"}', ${CODIGO_39}, 5), (${negocio}, ${producto}, '40', '{"Talla":"40"}', ${CODIGO_40}, 5)
      RETURNING id`;
    [t39, t40] = v.map((x) => x.id);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('la migración se puede aplicar otra vez', async () => {
    await sql.unsafe(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0060_0060_devolver_stockagile.sql'), 'utf8'));
    const t = await ticket([zueco39()]);
    expect((await consultar(t.id)).lines).toHaveLength(1);
  });

  describe('una devolución', () => {
    it('es una DEV normal: a vale, un solo +1 y sin reembolso en Shopify', async () => {
      const t = await ticket([zueco39()]);
      const antes = await stock(t39);
      const d = await devolver(t.id, [item39()]);
      expect(d.return_number).toMatch(/^DEV-\d{6}$/);
      expect(await stock(t39)).toBe(antes + 1);
      expect(await colas(d.return_id)).toEqual({ shopify: 1, stockagile: 1, misma: true });

      const [r] = await sql<{ total: string; sale_id: string | null; stockagile_sale_id: string; shopify_refund_status: string }[]>`
        SELECT total, sale_id, stockagile_sale_id, shopify_refund_status FROM sale_returns WHERE id = ${d.return_id}`;
      expect(Number(r.total)).toBe(149);
      expect(r.sale_id).toBeNull();
      expect(r.stockagile_sale_id).toBe(t.id);
      expect(r.shopify_refund_status).toBe('not_applicable');

      const [v] = await sql<{ initial_amount: string; balance: string }[]>`SELECT initial_amount, balance FROM store_vouchers WHERE source_return_id = ${d.return_id}`;
      expect(Number(v.initial_amount)).toBe(149);
      expect(Number(v.balance)).toBe(149);

      const [m] = await sql<{ delta: number; source: string }[]>`
        SELECT delta, source FROM stock_movements WHERE reference_id = ${d.return_id} AND variant_id = ${t39}`;
      expect(m).toMatchObject({ delta: 1, source: 'return' });
    });

    it('el vale queda a nombre de la clienta del ticket', async () => {
      const [c] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Ana') RETURNING id`;
      const t = await ticket([zueco39()], { cliente: c.id });
      const d = await devolver(t.id, [item39()]);
      const [v] = await sql<{ client_id: string }[]>`SELECT client_id FROM store_vouchers WHERE source_return_id = ${d.return_id}`;
      expect(v.client_id).toBe(c.id);
    });

    it('sin reponer: ni stock ni colas', async () => {
      const t = await ticket([zueco39()]);
      const antes = await stock(t39);
      const d = await devolver(t.id, [item39()], { restock: false });
      expect(await stock(t39)).toBe(antes);
      expect(await colas(d.return_id)).toMatchObject({ shopify: 0, stockagile: 0 });
    });

    it('sin talla: la devolución se hace, pero sin stock ni colas', async () => {
      const t = await ticket([{ nombre: 'Varios', codigo: null, total: 30 }]);
      const [art] = (await consultar(t.id)).lines;
      expect(art.variant_id).toBeNull();
      const d = await devolver(t.id, [{ line_key: art.line_key, quantity: 1, variant_id: null }]);
      expect(await colas(d.return_id)).toMatchObject({ shopify: 0, stockagile: 0 });
      const [i] = await sql<{ variant_id: string | null; total: string }[]>`SELECT variant_id, total FROM sale_return_items WHERE return_id = ${d.return_id}`;
      expect(i.variant_id).toBeNull();
      expect(Number(i.total)).toBe(30);
    });

    it('la talla que llega del mostrador manda: suma en esa, no en la del ticket', async () => {
      const t = await ticket([zueco39()]);
      const antes39 = await stock(t39);
      const antes40 = await stock(t40);
      await devolver(t.id, [{ line_key: clave(CODIGO_39), quantity: 1, variant_id: t40 }]);
      expect(await stock(t39)).toBe(antes39);
      expect(await stock(t40)).toBe(antes40 + 1);
    });

    it('una talla de otro negocio, no', async () => {
      const [pa] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${otro}, 'Ajeno', 1) RETURNING id`;
      const [va] = await sql<{ id: string }[]>`INSERT INTO product_variants (business_id, product_id, name, stock_quantity) VALUES (${otro}, ${pa.id}, '39', 1) RETURNING id`;
      const t = await ticket([zueco39()]);
      await expect(devolver(t.id, [{ line_key: clave(CODIGO_39), quantity: 1, variant_id: va.id }])).rejects.toMatchObject(DENEGADO);
      expect(await stock(va.id)).toBe(1);
    });
  });

  describe('tope', () => {
    it('reparte el total de la línea con su descuento, sin perder céntimos', async () => {
      const t = await ticket([zueco39({ cantidad: 3, total: 100 })]);
      const d1 = await devolver(t.id, [item39()]);
      const d2 = await devolver(t.id, [item39()]);
      const d3 = await devolver(t.id, [item39()]);
      const totales = await sql<{ total: string }[]>`SELECT total FROM sale_returns WHERE id IN (${d1.return_id}, ${d2.return_id}, ${d3.return_id})`;
      expect(totales.reduce((a, r) => a + Number(r.total), 0)).toBeCloseTo(100, 2);
      expect((await consultar(t.id)).lines[0].remaining).toBe(0);
    });

    it('no deja devolver más de lo comprado, ni cantidades raras', async () => {
      const t = await ticket([zueco39({ cantidad: 2, total: 298 })]);
      await expect(devolver(t.id, [item39(3)])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [item39(-1)])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [{ ...item39(), quantity: 1.5 }])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [item39(0)])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [item39(), item39()])).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [{ line_key: 'b:otro', quantity: 1 }])).rejects.toMatchObject(NO_VALIDO);
    });

    it('la segunda devolución del mismo par falla', async () => {
      const t = await ticket([zueco39()]);
      await devolver(t.id, [item39()]);
      await expect(devolver(t.id, [item39()])).rejects.toMatchObject(NO_VALIDO);
      const a = (await consultar(t.id)).lines[0];
      expect(a).toMatchObject({ returned_pymova: 1, returned_stockagile: 0, remaining: 0 });
    });

    it('a la vez: solo una gana y solo suma un +1', async () => {
      const t = await ticket([zueco39()]);
      const antes = await stock(t39);
      const r = await Promise.allSettled([devolver(t.id, [item39()]), devolver(t.id, [item39()])]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(await stock(t39)).toBe(antes + 1);
    });

    it('descuenta lo devuelto en Stockagile', async () => {
      const t = await ticket([zueco39({ cantidad: 2, total: 298 })]);
      await ticket([zueco39({ cantidad: -1, total: -149 })], { devuelveA: t.external });
      const a = (await consultar(t.id)).lines[0];
      expect(a).toMatchObject({ quantity: 2, returned_stockagile: 1, remaining: 1 });
      await expect(devolver(t.id, [item39(2)])).rejects.toMatchObject(NO_VALIDO);
      await devolver(t.id, [item39(1)]);
      expect((await consultar(t.id)).lines[0].remaining).toBe(0);
    });

    it('casa la devolución de Stockagile por nombre si no trae código, y no cuenta las borradas', async () => {
      const t = await ticket([zueco39()]);
      await ticket([zueco39({ cantidad: -1, total: -149 })], { devuelveA: t.external, deleted: true });
      expect((await consultar(t.id)).lines[0].remaining).toBe(1);
      await ticket([zueco39({ cantidad: -1, total: -149, codigo: null })], { devuelveA: t.external });
      expect((await consultar(t.id)).lines[0].remaining).toBe(0);
    });

    it('una línea negativa dentro de la misma venta resta', async () => {
      const t = await ticket([zueco39({ cantidad: 2, total: 298 }), zueco39({ cantidad: -1, total: -149 })]);
      const [a] = (await consultar(t.id)).lines;
      expect(a).toMatchObject({ quantity: 2, returned_stockagile: 1, remaining: 1 });
    });

    it('lo nuevo de un cambio se puede devolver; lo que entró en ese cambio no cuenta contra ello', async () => {
      const a = await ticket([zueco39()]);
      const cambio = await ticket(
        [zueco39({ cantidad: -1, total: -149 }), zueco39({ nombre: 'Zueco Bolonia Negro - 40', codigo: CODIGO_40, talla: '40', variante: t40 })],
        { devuelveA: a.external },
      );
      expect((await consultar(a.id)).lines[0].remaining).toBe(0);
      const lineas = (await consultar(cambio.id)).lines;
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({ line_key: clave(CODIGO_40), remaining: 1 });
      await devolver(cambio.id, [{ line_key: clave(CODIGO_40), quantity: 1, variant_id: t40 }]);
    });

    it('un cambio del mismo artículo en el mismo ticket no se resta a sí mismo', async () => {
      const a = await ticket([zueco39()]);
      const cambio = await ticket([zueco39({ cantidad: -1, total: -149 }), zueco39()], { devuelveA: a.external });
      expect((await consultar(cambio.id)).lines[0].remaining).toBe(1);
    });

    it('avisa si se ha devuelto de más entre los dos sistemas', async () => {
      const t = await ticket([zueco39()]);
      await devolver(t.id, [item39()]);
      await ticket([zueco39({ cantidad: -1, total: -149 })], { devuelveA: t.external });
      const r = await consultar(t.id);
      expect(r.over_returned).toBe(true);
      expect(r.lines[0].remaining).toBe(-1);
    });

    it('no ofrece líneas con total negativo ni con cantidad cero', async () => {
      const t = await ticket([zueco39(), { nombre: 'Ajuste', codigo: null, total: -10 }, { nombre: 'Nada', codigo: null, cantidad: 0, total: 0 }]);
      expect((await consultar(t.id)).lines.map((l) => l.product_name)).toEqual(['Zueco Bolonia Negro - 39']);
    });

    it('reimportar el ticket (borrar y recrear las líneas) no olvida lo devuelto', async () => {
      const t = await ticket([zueco39({ cantidad: 2, total: 298 })]);
      await devolver(t.id, [item39()]);
      await sql`DELETE FROM stockagile_sale_items WHERE sale_id = ${t.id}`;
      await sql`
        INSERT INTO stockagile_sale_items (sale_id, product_name, size, barcode, quantity, unit_price, total, variant_id)
        VALUES (${t.id}, 'Zueco Bolonia Negro - 39', '39', ${CODIGO_39}, 2, 149, 298, ${t39})`;
      expect((await consultar(t.id)).lines[0]).toMatchObject({ returned_pymova: 1, remaining: 1 });
    });
  });

  describe('enlace con la talla', () => {
    it('por la talla de la línea o por el código', async () => {
      const t = await ticket([zueco39({ variante: null })]);
      expect((await consultar(t.id)).lines[0]).toMatchObject({ variant_id: t39, variant_match: 'code', variant_name: 'Zueco Bolonia Negro · 39' });
    });

    it('por nombre y talla exactos, sin distinguir mayúsculas ni espacios, y pidiendo confirmar', async () => {
      const t = await ticket([{ nombre: 'ZUECO  Bolonia negro - 40', codigo: null, total: 149, talla: '40' }]);
      expect((await consultar(t.id)).lines[0]).toMatchObject({ variant_id: t40, variant_match: 'name' });
    });

    it('no adivina si hay más de un candidato o no hay ninguno', async () => {
      const [p2] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Sandalia Doble', 1) RETURNING id`;
      await sql`INSERT INTO product_variants (business_id, product_id, name, attributes, stock_quantity) VALUES (${negocio}, ${p2.id}, '38', '{"Talla":"38"}', 1)`;
      const [p3] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Sandalia Doble', 1) RETURNING id`;
      await sql`INSERT INTO product_variants (business_id, product_id, name, attributes, stock_quantity) VALUES (${negocio}, ${p3.id}, '38', '{"Talla":"38"}', 1)`;
      const doble = await ticket([{ nombre: 'Sandalia Doble - 38', codigo: null, total: 50, talla: '38' }]);
      expect((await consultar(doble.id)).lines[0]).toMatchObject({ variant_id: null, variant_match: null });
      const nada = await ticket([{ nombre: 'Venta de Archivo - 37', codigo: null, total: 50, talla: '37' }]);
      expect((await consultar(nada.id)).lines[0]).toMatchObject({ variant_id: null, variant_match: null });
    });
  });

  describe('qué tickets', () => {
    const bloqueado = async (t: { id: string }, patron: RegExp) => {
      expect((await consultar(t.id)).blocked).toMatch(patron);
      await expect(devolver(t.id, [item39()])).rejects.toMatchObject(NO_VALIDO);
    };

    it('otro almacén, no', async () => {
      await bloqueado(await ticket([zueco39()], { almacen: 'Almacén Madrid' }), /tienda/);
      await bloqueado(await ticket([zueco39()], { almacen: null }), /tienda/);
    });

    it('anulado, no', async () => {
      await bloqueado(await ticket([zueco39()], { deleted: true }), /anulado/);
    });

    it('más de 180 días, no; 179, sí', async () => {
      await bloqueado(await ticket([zueco39()], { fecha: hace(181) }), /180/);
      const t = await ticket([zueco39()], { fecha: hace(179) });
      expect((await consultar(t.id)).blocked).toBeNull();
      await devolver(t.id, [item39()]);
    });

    it('sin almacén configurado, ninguno', async () => {
      await sql`UPDATE stockagile_connections SET returns_warehouse_name = NULL WHERE business_id = ${negocio}`;
      await bloqueado(await ticket([zueco39()]), /tienda/);
      await sql`UPDATE stockagile_connections SET returns_warehouse_name = ${TIENDA} WHERE business_id = ${negocio}`;
    });

    it('la migración deja configurada solo la tienda de TUILUS', async () => {
      const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stockagile_connections WHERE returns_warehouse_name IS NOT NULL AND business_id <> ${negocio}`;
      expect(c.n).toBe(0);
    });
  });

  describe('quién puede', () => {
    it('otro negocio y anónimo, no; tampoco ver lo que queda', async () => {
      const t = await ticket([zueco39()]);
      await expect(devolver(t.id, [item39()], { user: ajeno })).rejects.toMatchObject(DENEGADO);
      await expect(devolver(t.id, [item39()], { user: ajeno, business: otro })).rejects.toMatchObject(DENEGADO);
      await expect(consultar(t.id, ajeno)).rejects.toMatchObject(DENEGADO);
      await expect(consultar(t.id, ajeno, otro)).rejects.toMatchObject(DENEGADO);
      await expect(asAnon(sql, (tx) => tx`SELECT public.get_stockagile_returnable(${negocio}, ${t.id})`)).rejects.toMatchObject(DENEGADO);
      await expect(asAnon(sql, (tx) => tx`
        SELECT * FROM public.create_stockagile_return(${negocio}, ${t.id}, '[]'::jsonb, null, 'cash', true, null, null)`)).rejects.toMatchObject(DENEGADO);
    });

    it('nadie escribe directamente, ni el propietario', async () => {
      const t = await ticket([zueco39()]);
      await expect(asUser(sql, owner, (tx) => tx`
        INSERT INTO sale_returns (business_id, stockagile_sale_id, return_number) VALUES (${negocio}, ${t.id}, 'DEV-X')`)).rejects.toMatchObject(DENEGADO);
    });

    it('las funciones internas no se pueden llamar', async () => {
      const t = await ticket([zueco39()]);
      await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM public.stockagile_return_lines(${t.id})`)).rejects.toMatchObject(DENEGADO);
      await expect(asUser(sql, owner, (tx) => tx`SELECT public.stockagile_line_key('a', 'b')`)).rejects.toMatchObject(DENEGADO);
    });

    it('una devolución debe tener un solo origen', async () => {
      await expect(sql`INSERT INTO sale_returns (business_id, return_number) VALUES (${negocio}, 'DEV-NADA')`).rejects.toMatchObject({ code: '23514' });
    });

    it('el enlace nuevo se lee con la cuenta del usuario; el coste, no', async () => {
      const t = await ticket([zueco39()]);
      const d = await devolver(t.id, [item39()]);
      const [i] = await asUser(sql, staff, (tx) => tx<{ stockagile_line_key: string }[]>`SELECT stockagile_line_key FROM sale_return_items WHERE return_id = ${d.return_id}`);
      expect(i.stockagile_line_key).toBe(clave(CODIGO_39));
      await expect(asUser(sql, staff, (tx) => tx`SELECT unit_cost FROM sale_return_items WHERE return_id = ${d.return_id}`)).rejects.toMatchObject(DENEGADO);
    });
  });

  describe('caja, ficha e informe', () => {
    it('efectivo: pide caja abierta y el arqueo lo descuenta una vez', async () => {
      const t = await ticket([zueco39()]);
      await expect(devolver(t.id, [item39()], { metodo: 'cash' })).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [item39()], { metodo: null })).rejects.toMatchObject(NO_VALIDO);
      await expect(devolver(t.id, [item39()], { metodo: 'bizum' })).rejects.toMatchObject(NO_VALIDO);

      const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 200) AS id`);
      await devolver(t.id, [item39()], { metodo: 'cash' });
      await asUser(sql, owner, (tx) => tx`SELECT public.close_register_session(${c.id}, 51, null)`);
      const [r] = await sql<{ expected_amount: string; difference: string }[]>`SELECT expected_amount, difference FROM cash_register_sessions WHERE id = ${c.id}`;
      expect(Number(r.expected_amount)).toBe(51);
      expect(Number(r.difference)).toBe(0);
    });

    it('tarjeta: no crea vale ni toca el efectivo', async () => {
      const t = await ticket([zueco39()]);
      const d = await devolver(t.id, [item39()], { metodo: 'card' });
      const v = await sql`SELECT 1 FROM store_vouchers WHERE source_return_id = ${d.return_id}`;
      expect(v).toHaveLength(0);
    });

    it('la ficha de la clienta enseña el ticket como devuelto', async () => {
      const [c] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name) VALUES (${negocio}, 'Marta') RETURNING id`;
      const t = await ticket([zueco39({ cantidad: 2, total: 200 })], { cliente: c.id });
      await devolver(t.id, [item39()]);
      const [p] = await sql<{ net: string; status: string }[]>`
        SELECT net, status FROM public.client_purchases(${negocio}) WHERE purchase_id = ${t.id}`;
      expect(Number(p.net)).toBe(100);
      expect(p.status).toBe('returned');
    });

    it('el informe resta la devolución una vez y la venta sigue en Stockagile', async () => {
      const [n] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Informe', null) AS id`);
      await sql`INSERT INTO stockagile_connections (business_id, enabled, returns_warehouse_name) VALUES (${n.id}, true, ${TIENDA})`;
      const t = await ticket([zueco39({ variante: null })], { negocio: n.id });
      const dia = new Date().toISOString().slice(0, 10);
      const desde = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      await devolver(t.id, [{ line_key: clave(CODIGO_39), quantity: 1, variant_id: null }], { user: ajeno, business: n.id });
      await sql`UPDATE business_members SET role = 'owner' WHERE business_id = ${n.id} AND user_id = ${ajeno}`;
      const [r] = await asUser(sql, ajeno, (tx) => tx<{ r: { current: Record<string, number> } }[]>`
        SELECT public.get_sales_report(${n.id}, ${desde}::date, ${dia}::date) AS r`);
      const kpi = r.r.current;
      expect(Number(kpi.sales_total)).toBe(149);
      expect(Number(kpi.returns_total)).toBe(149);
      expect(Number(kpi.net_total)).toBe(0);
    });

    it('borrar un negocio con estas devoluciones no se atasca', async () => {
      const [n] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Para borrar', null) AS id`);
      await sql`INSERT INTO stockagile_connections (business_id, enabled, returns_warehouse_name) VALUES (${n.id}, true, ${TIENDA})`;
      const t = await ticket([zueco39({ variante: null })], { negocio: n.id });
      await devolver(t.id, [{ line_key: clave(CODIGO_39), quantity: 1, variant_id: null }], { user: ajeno, business: n.id });
      await sql`DELETE FROM businesses WHERE id = ${n.id}`;
      const q = await sql`SELECT 1 FROM stockagile_sales WHERE id = ${t.id}`;
      expect(q).toHaveLength(0);
    });
  });

  describe('con dependientes con PIN', () => {
    let conPin: string;
    let tpv: string;
    let luis: string;
    let ana: string;

    const sesion = async (employee: string, pin: string) => {
      const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; session_id: string }[]>`
        SELECT * FROM public.start_seller_session(${conPin}, ${employee}, ${pin})`);
      expect(r.ok).toBe(true);
      return r.session_id;
    };
    const autorizar = async (employee: string, pin: string, accion = 'return') => {
      const [r] = await asUser(sql, tpv, (tx) => tx<{ ok: boolean; authorization_id: string | null }[]>`
        SELECT * FROM public.authorize_action(${conPin}, ${employee}, ${pin}, ${accion}, null)`);
      return r;
    };
    const unTicket = () => ticket([zueco39({ variante: null })], { negocio: conPin });
    const sinTalla = (): Item => ({ line_key: clave(CODIGO_39), quantity: 1, variant_id: null });

    beforeAll(async () => {
      tpv = await createUser(sql, 'tienda@ejemplo.test');
      const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Con PIN', null) AS id`);
      conPin = b.id;
      await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${conPin}, ${tpv}, 'staff', true)`;
      await sql`INSERT INTO stockagile_connections (business_id, enabled, returns_warehouse_name) VALUES (${conPin}, true, ${TIENDA})`;
      const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${conPin}) AS id`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${eo.id}, '9999')`);
      const [l] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Luis') AS id`);
      luis = l.id;
      const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Ana') AS id`);
      ana = a.id;
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${luis}, '2222')`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${ana}, '1111')`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${conPin}, ${luis}, 10, true, false, false, false, false)`);
    });

    it('con permiso, y queda a su nombre', async () => {
      const t = await unTicket();
      const d = await devolver(t.id, [sinTalla()], { user: tpv, business: conPin, sesion: await sesion(luis, '2222') });
      const [r] = await sql<{ seller_employee_id: string; authorized_by_employee_id: string | null }[]>`
        SELECT seller_employee_id, authorized_by_employee_id FROM sale_returns WHERE id = ${d.return_id}`;
      expect(r).toEqual({ seller_employee_id: luis, authorized_by_employee_id: null });
    });

    it('sin permiso pide autorización, de un solo uso, y queda quién autorizó', async () => {
      const s = await sesion(ana, '1111');
      const t = await unTicket();
      await expect(devolver(t.id, [sinTalla()], { user: tpv, business: conPin, sesion: s })).rejects.toMatchObject(DENEGADO);

      const a = await autorizar(luis, '2222');
      const d = await devolver(t.id, [sinTalla()], { user: tpv, business: conPin, sesion: s, autorizacion: a.authorization_id });
      const [r] = await sql<{ seller_employee_id: string; authorized_by_employee_id: string }[]>`
        SELECT seller_employee_id, authorized_by_employee_id FROM sale_returns WHERE id = ${d.return_id}`;
      expect(r).toEqual({ seller_employee_id: ana, authorized_by_employee_id: luis });

      const t2 = await unTicket();
      await expect(devolver(t2.id, [sinTalla()], { user: tpv, business: conPin, sesion: s, autorizacion: a.authorization_id })).rejects.toMatchObject(DENEGADO);
    });

    it('quien no tiene el permiso no puede autorizarlo', async () => {
      const r = await autorizar(ana, '1111');
      expect(r.ok).toBe(false);
    });
  });
});
