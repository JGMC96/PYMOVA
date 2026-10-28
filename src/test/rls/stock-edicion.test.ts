// @vitest-environment node
// Edición de stock (0057): varias tallas de un producto con un motivo, todo o nada, por
// adjust_stock_batch. Con Stockagile conectado, cada ajuste va a su cola con signo (y no a la de
// Shopify), una sola vez por movimiento; sin Stockagile, a la de Shopify como hasta ahora.
// Un ajuste que aún no ha llegado a Stockagile no lo deshace un aviso de Shopify con la cifra vieja.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const TIENDA = 'gid://shopify/Location/1';

interface Linea {
  variant_id: string | null;
  expected: number;
  new_quantity: number;
}

describe.skipIf(!RLS_DB_URL)('RLS · edición de stock por tallas y a Stockagile', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let admin: string;
  let staff: string;
  let tienda: string; // con Stockagile
  let otra: string; // sin Stockagile
  let numero = 0;

  const lote = (user: string, negocio: string, producto: string, lineas: Linea[], motivo = 'Recuento') =>
    asUser(sql, user, (tx) => tx<{ changed: number; to_stockagile: boolean }[]>`
      SELECT * FROM public.adjust_stock_batch(${negocio}, ${producto}, ${sql.json(lineas as never)}::jsonb, ${motivo})`);

  const stock = async (id: string) => {
    const [r] = await sql`SELECT stock_quantity FROM product_variants WHERE id = ${id}`;
    return r.stock_quantity as number;
  };

  /** Producto con tallas (stock 5, 3 y 0), emparejado con Shopify en la ubicación de la tienda. */
  const zueco = async (negocio: string) => {
    numero += 1;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, track_inventory) VALUES (${negocio}, ${'Zueco ' + numero}, 50, true) RETURNING id`;
    const tallas: string[] = [];
    for (const [talla, cantidad] of [['38', 5], ['39', 3], ['40', 0]] as const) {
      const [v] = await sql<{ id: string }[]>`
        INSERT INTO product_variants (business_id, product_id, name, price, stock_quantity)
        VALUES (${negocio}, ${p.id}, ${talla}, 50, ${cantidad}) RETURNING id`;
      await sql`
        INSERT INTO shopify_inventory_levels (business_id, local_product_id, local_variant_id, inventory_item_gid, location_gid, available)
        VALUES (${negocio}, ${p.id}, ${v.id}, ${'gid://shopify/InventoryItem/' + numero + talla}, ${TIENDA}, ${cantidad})`;
      tallas.push(v.id);
    }
    return { producto: p.id, tallas };
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    admin = await createUser(sql, 'admin@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    tienda = a.id;
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otra = b.id;
    for (const negocio of [tienda, otra]) {
      await sql`
        INSERT INTO business_members (business_id, user_id, role, is_active)
        VALUES (${negocio}, ${admin}, 'admin', true), (${negocio}, ${staff}, 'staff', true)`;
      await sql`
        INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
        VALUES (${negocio}, ${'prueba-' + negocio.slice(0, 8) + '.myshopify.com'}, ${TIENDA}, true)`;
    }
    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${tienda})`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('con Stockagile: varias tallas de una vez, con signo, una sola vez y sin pasar por la cola de Shopify', async () => {
    const { producto, tallas } = await zueco(tienda);
    const [r] = await lote(admin, tienda, producto, [
      { variant_id: tallas[0], expected: 5, new_quantity: 4 },
      { variant_id: tallas[1], expected: 3, new_quantity: 3 },
      { variant_id: tallas[2], expected: 0, new_quantity: 2 },
    ]);
    expect(r).toEqual({ changed: 2, to_stockagile: true });
    expect([await stock(tallas[0]), await stock(tallas[1]), await stock(tallas[2])]).toEqual([4, 3, 2]);

    const movs = await sql<{ id: string; variant_id: string; delta: number; note: string; reference_id: string }[]>`
      SELECT id, variant_id, delta, note, reference_id FROM stock_movements
      WHERE product_id = ${producto} AND source = 'manual' ORDER BY delta`;
    expect(movs.map((m) => [m.variant_id, m.delta, m.note])).toEqual([
      [tallas[0], -1, 'Recuento'],
      [tallas[2], 2, 'Recuento'],
    ]);
    expect(movs[0].reference_id).toBe(movs[1].reference_id); // un solo lote

    const cola = await sql<{ local_variant_id: string; quantity: number; reason: string; source_table: string; source_id: string; status: string }[]>`
      SELECT local_variant_id, quantity, reason, source_table, source_id, status FROM stockagile_stock_moves
      WHERE local_product_id = ${producto} ORDER BY quantity`;
    expect(cola).toEqual([
      { local_variant_id: tallas[0], quantity: -1, reason: 'adjustment', source_table: 'stock_movements', source_id: movs[0].id, status: 'pending' },
      { local_variant_id: tallas[2], quantity: 2, reason: 'adjustment', source_table: 'stock_movements', source_id: movs[1].id, status: 'pending' },
    ]);
    const [shopify] = await sql`SELECT count(*)::int AS n FROM shopify_inventory_pushes WHERE local_product_id = ${producto}`;
    expect(shopify.n).toBe(0);

    // El ajuste de una sola talla (adjust_stock) va por el mismo camino.
    const [uno] = await asUser(sql, owner, (tx) => tx<{ delta: number }[]>`
      SELECT public.adjust_stock(${tienda}, ${producto}, ${tallas[1]}, 1, 'Rotura o defecto') AS delta`);
    expect(uno.delta).toBe(-2);
    const [m] = await sql`SELECT quantity FROM stockagile_stock_moves WHERE local_variant_id = ${tallas[1]}`;
    expect(m.quantity).toBe(-2);
  });

  it('todo o nada: si una talla cambió mientras se editaba, no se guarda ninguna', async () => {
    const { producto, tallas } = await zueco(tienda);
    await expect(
      lote(admin, tienda, producto, [
        { variant_id: tallas[0], expected: 5, new_quantity: 9 },
        { variant_id: tallas[1], expected: 2, new_quantity: 0 }, // en realidad hay 3
      ]),
    ).rejects.toMatchObject({ code: '40001', message: expect.stringMatching(/«39» ha cambiado.*ahora hay 3/) });
    expect([await stock(tallas[0]), await stock(tallas[1])]).toEqual([5, 3]);
    const [n] = await sql`SELECT count(*)::int AS n FROM stock_movements WHERE product_id = ${producto} AND source = 'manual'`;
    expect(n.n).toBe(0);
    const [c] = await sql`SELECT count(*)::int AS n FROM stockagile_stock_moves WHERE local_product_id = ${producto}`;
    expect(c.n).toBe(0);
  });

  it('sin Stockagile: el lote va a la cola de Shopify, con el id de cada movimiento', async () => {
    const { producto, tallas } = await zueco(otra);
    const [r] = await lote(admin, otra, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 7 }], 'Entrada de mercancía');
    expect(r).toEqual({ changed: 1, to_stockagile: false });
    const [mov] = await sql`SELECT id FROM stock_movements WHERE variant_id = ${tallas[0]} AND source = 'manual'`;
    const [cola] = await sql`
      SELECT delta, reason, source_table, source_id FROM shopify_inventory_pushes WHERE local_variant_id = ${tallas[0]}`;
    expect(cola).toEqual({ delta: 2, reason: 'adjustment', source_table: 'stock_movements', source_id: mov.id });
    const [c] = await sql`SELECT count(*)::int AS n FROM stockagile_stock_moves WHERE business_id = ${otra}`;
    expect(c.n).toBe(0);
  });

  it('un aviso de Shopify con la cifra vieja no deshace un ajuste que aún no ha llegado a Stockagile', async () => {
    const { producto, tallas } = await zueco(tienda);
    await lote(admin, tienda, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 2 }]);
    const nivel = (disponible: number, cuando: string) => sql`
      SELECT * FROM public.apply_shopify_inventory_levels(${tienda},
        ${sql.json([{ inventory_item_gid: `gid://shopify/InventoryItem/${numero}38`, location_gid: TIENDA, available: disponible, updated_at: cuando }] as never)}::jsonb, 'shopify')`;

    await nivel(5, '2026-10-28T12:00:00Z'); // Shopify aún no lo tiene
    expect(await stock(tallas[0])).toBe(2);

    // Stockagile lo aplica y lo pasa a Shopify: el aviso trae ya la cifra nueva.
    await sql`UPDATE stockagile_stock_moves SET status = 'done' WHERE local_variant_id = ${tallas[0]}`;
    await nivel(2, '2026-10-28T12:01:00Z');
    expect(await stock(tallas[0])).toBe(2);
  });

  it('el alta con stock inicial no va a Stockagile', async () => {
    const { producto } = await zueco(tienda);
    const [c] = await sql`SELECT count(*)::int AS n FROM stockagile_stock_moves WHERE local_product_id = ${producto}`;
    expect(c.n).toBe(0);
  });

  it('producto sin tallas: una línea sin variante; con tallas, no', async () => {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory)
      VALUES (${tienda}, 'Calcetín', 6, 10, true) RETURNING id`;
    const [r] = await lote(owner, tienda, s.id, [{ variant_id: null, expected: 10, new_quantity: 8 }]);
    expect(r.changed).toBe(1);
    const [m] = await sql`SELECT quantity, local_variant_id FROM stockagile_stock_moves WHERE local_product_id = ${s.id}`;
    expect(m).toEqual({ quantity: -2, local_variant_id: null });

    const { producto } = await zueco(tienda);
    await expect(lote(owner, tienda, producto, [{ variant_id: null, expected: 8, new_quantity: 1 }])).rejects.toThrow(/variantes/);
  });

  it('permiso, ids de otro producto o negocio y entradas inválidas', async () => {
    const { producto, tallas } = await zueco(tienda);
    const otroZueco = await zueco(tienda);
    const deOtra = await zueco(otra);
    const linea = { variant_id: tallas[0], expected: 5, new_quantity: 4 };

    await expect(lote(staff, tienda, producto, [linea])).rejects.toMatchObject(PERMISO_DENEGADO);
    const ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    await expect(lote(ajeno, tienda, producto, [linea])).rejects.toMatchObject(PERMISO_DENEGADO);
    // Talla de otro producto, o producto de otro negocio.
    await expect(
      lote(admin, tienda, producto, [{ variant_id: otroZueco.tallas[0], expected: 5, new_quantity: 1 }]),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(lote(admin, tienda, deOtra.producto, [linea])).rejects.toMatchObject(PERMISO_DENEGADO);

    await expect(lote(admin, tienda, producto, [linea], '  ')).rejects.toThrow(/motivo/i);
    await expect(lote(admin, tienda, producto, [])).rejects.toThrow(/cambios/i);
    await expect(lote(admin, tienda, producto, [{ ...linea, new_quantity: -1 }])).rejects.toThrow(/negativ/i);
    await expect(lote(admin, tienda, producto, [linea, linea])).rejects.toThrow(/dos veces/i);
    expect(await stock(tallas[0])).toBe(5);
  });

  it('los avisos de Stockagile enseñan el signo del movimiento', async () => {
    const { producto, tallas } = await zueco(tienda);
    await lote(admin, tienda, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 3 }]);
    await sql`UPDATE stockagile_stock_moves SET status = 'failed', last_error = 'Sin emparejar' WHERE local_variant_id = ${tallas[0]}`;
    const avisos = await asUser(sql, admin, (tx) => tx<{ reference: string }[]>`
      SELECT reference FROM public.get_shopify_problems(${tienda}) WHERE kind = 'stockagile'`);
    expect(avisos.map((a) => a.reference)).toContain(`Zueco ${numero} · 38 (-2)`);
  });

  it('historial: quién y qué artículo, filtrado por producto, solo para miembros', async () => {
    const { producto, tallas } = await zueco(otra);
    await lote(admin, otra, producto, [{ variant_id: tallas[1], expected: 3, new_quantity: 1 }], 'Rotura o defecto: suela');
    const filas = await asUser(sql, staff, (tx) => tx<{ product_name: string; variant_name: string; delta: number; stock_after: number; source: string; note: string; who: string | null }[]>`
      SELECT product_name, variant_name, delta, stock_after, source, note, who FROM public.get_stock_movements(${otra}, ${producto})`);
    expect(filas[0]).toMatchObject({
      product_name: `Zueco ${numero}`, variant_name: '39', delta: -2, stock_after: 1, source: 'manual', note: 'Rotura o defecto: suela',
    });
    expect(filas[0].who).toBeTruthy();
    // Las altas de las tallas, sin quién (las hizo la prueba como superusuario).
    expect(filas.filter((f) => f.source === 'initial').every((f) => f.who === null)).toBe(true);

    const soloAjustes = await asUser(sql, staff, (tx) => tx<{ source: string }[]>`
      SELECT source FROM public.get_stock_movements(${otra}, null, 'manual', 10)`);
    expect(soloAjustes.length).toBeGreaterThan(0);
    expect(soloAjustes.every((f) => f.source === 'manual')).toBe(true);

    const ajeno = await createUser(sql, 'curioso@ejemplo.test');
    await expect(
      asUser(sql, ajeno, (tx) => tx`SELECT * FROM public.get_stock_movements(${otra})`),
    ).rejects.toMatchObject(PERMISO_DENEGADO);
  });

  describe('con dependientes con PIN: cada guardado lleva el PIN de quien ajusta', () => {
    let conPin: string;
    let tpv: string; // cuenta de personal compartida, sin permiso propio de stock
    let empOwner: string;
    let luis: string; // encargado con permiso de ajustar stock
    let ana: string; // dependienta sin permiso

    const autorizar = async (employee: string, pin: string, accion = 'adjust_stock', user = tpv) => {
      const [r] = await asUser(sql, user, (tx) => tx<{ ok: boolean; error: string | null; locked_seconds: number; authorization_id: string | null }[]>`
        SELECT * FROM public.authorize_action(${conPin}, ${employee}, ${pin}, ${accion}, null)`);
      return r;
    };
    const loteCon = (autorizacion: string | null, producto: string, lineas: Linea[], user = tpv) =>
      asUser(sql, user, (tx) => tx<{ changed: number }[]>`
        SELECT * FROM public.adjust_stock_batch(${conPin}, ${producto}, ${sql.json(lineas as never)}::jsonb, 'Recuento', ${autorizacion})`);

    beforeAll(async () => {
      tpv = await createUser(sql, 'tienda@ejemplo.test');
      const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Con PIN', null) AS id`);
      conPin = b.id;
      await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${conPin}, ${tpv}, 'staff', true)`;
      await sql`
        INSERT INTO shopify_connections (business_id, shop_domain, default_location_gid, stock_push_enabled)
        VALUES (${conPin}, 'con-pin.myshopify.com', ${TIENDA}, true)`;
      const [eo] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${conPin}) AS id`);
      empOwner = eo.id;
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${empOwner}, '9999')`);
      const [l] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Luis') AS id`);
      luis = l.id;
      const [a] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.upsert_pos_employee(${conPin}, null, 'Ana') AS id`);
      ana = a.id;
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${luis}, '2222')`);
      await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_pin(${conPin}, ${ana}, '1111')`);
      await asUser(sql, owner, (tx) => tx`
        SELECT public.set_employee_permissions(${conPin}, ${luis}, 10, false, false, false, false, true)`);
    });

    it('sin PIN no se guarda, ni siendo propietario; adjust_stock tampoco sirve', async () => {
      const { producto, tallas } = await zueco(conPin);
      const linea = { variant_id: tallas[0], expected: 5, new_quantity: 4 };
      await expect(loteCon(null, producto, [linea], owner)).rejects.toMatchObject({
        code: '42501', message: expect.stringMatching(/autorizaci/i),
      });
      await expect(
        asUser(sql, owner, (tx) => tx`SELECT public.adjust_stock(${conPin}, ${producto}, ${tallas[0]}, 4, 'Recuento')`),
      ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/PIN/) });
      expect(await stock(tallas[0])).toBe(5);
    });

    it('con el PIN de alguien con permiso, la cuenta compartida guarda y queda quién fue', async () => {
      const { producto, tallas } = await zueco(conPin);
      const pase = await autorizar(luis, '2222');
      expect(pase.ok).toBe(true);
      const [r] = await loteCon(pase.authorization_id, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 2 }]);
      expect(r.changed).toBe(1);
      const [m] = await sql`SELECT employee_id, created_by, delta FROM stock_movements WHERE variant_id = ${tallas[0]} AND source = 'manual'`;
      expect(m).toEqual({ employee_id: luis, created_by: tpv, delta: -3 });
      const [h] = await asUser(sql, tpv, (tx) => tx<{ who: string }[]>`
        SELECT who FROM public.get_stock_movements(${conPin}, ${producto}, 'manual')`);
      expect(h.who).toBe('Luis');

      // El pase es de un solo uso.
      await expect(
        loteCon(pase.authorization_id, producto, [{ variant_id: tallas[1], expected: 3, new_quantity: 1 }]),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('el propietario también pone su PIN; sin permiso, de otra cuenta o de otra acción, no vale', async () => {
      const { producto, tallas } = await zueco(conPin);
      const delOwner = await autorizar(empOwner, '9999', 'adjust_stock', owner);
      const [r] = await loteCon(delOwner.authorization_id, producto, [{ variant_id: tallas[2], expected: 0, new_quantity: 6 }], owner);
      expect(r.changed).toBe(1);

      const sinPermiso = await autorizar(ana, '1111');
      expect(sinPermiso).toMatchObject({ ok: false, authorization_id: null });
      expect(sinPermiso.error).toMatch(/Ana no tiene permiso/);

      const deOtraCuenta = await autorizar(luis, '2222', 'adjust_stock', owner);
      await expect(
        loteCon(deOtraCuenta.authorization_id, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 1 }]),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      const deDevolver = await autorizar(empOwner, '9999', 'return');
      await expect(
        loteCon(deDevolver.authorization_id, producto, [{ variant_id: tallas[0], expected: 5, new_quantity: 1 }]),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      expect(await stock(tallas[0])).toBe(5);
    });

    it('tras 5 PIN fallidos, 5 minutos de bloqueo', async () => {
      for (let i = 0; i < 4; i++) expect((await autorizar(luis, '0000')).ok).toBe(false);
      const quinto = await autorizar(luis, '0000');
      expect(quinto.ok).toBe(false);
      expect(quinto.locked_seconds).toBeGreaterThan(0);
      const bloqueado = await autorizar(luis, '2222');
      expect(bloqueado.ok).toBe(false);
      expect(bloqueado.locked_seconds).toBeGreaterThan(0);
    });
  });
});
