// @vitest-environment node
// Códigos para productos nuevos (0043): EAN-13 de la serie del negocio y SKU, solo para tallas
// sin código, sin repetir nunca; bloqueado mientras Stockagile esté conectado; quien puede
// editar el catálogo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };

const checkDigit = (first12: string) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
};

describe.skipIf(!RLS_DB_URL)('RLS · códigos para productos nuevos', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let owner: string;
  let staff: string;
  let catalogo: string; // personal con permiso de catálogo
  let producto: string;
  let v38: string;
  let v39: string;
  let v40: string;

  const reservar = (items: unknown[], user = catalogo) =>
    asUser(sql, user, (tx) => tx<{ variant_id: string; sku: string | null; barcode: string | null; variant_external_id: string | null }[]>`
      SELECT * FROM public.reserve_catalog_codes(${negocio}, ${producto}, ${sql.json(items as never)}::jsonb) ORDER BY sku`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'staff@ejemplo.test');
    catalogo = await createUser(sql, 'catalogo@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    await sql`
      INSERT INTO business_members (business_id, user_id, role, is_active)
      VALUES (${negocio}, ${staff}, 'staff', true), (${negocio}, ${catalogo}, 'staff', true)`;
    const [e] = await asUser(sql, catalogo, (tx) => tx<{ id: string }[]>`SELECT public.ensure_hr_employee(${negocio}) AS id`);
    await asUser(sql, owner, (tx) => tx`SELECT public.set_employee_permissions(${negocio}, ${e.id}, 10, false, false, true, false, false)`);
    await sql`INSERT INTO business_settings (business_id, ean_prefix) VALUES (${negocio}, '9600000')
      ON CONFLICT (business_id) DO UPDATE SET ean_prefix = '9600000'`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, external_id, external_source) VALUES (${negocio}, 'Zueco Nuevo', 99, 'gid://shopify/Product/1', 'shopify') RETURNING id`;
    producto = p.id;
    const variante = async (name: string, sku: string | null, barcode: string | null) => {
      const [v] = await sql<{ id: string }[]>`
        INSERT INTO product_variants (business_id, product_id, name, sku, barcode, external_id, external_source)
        VALUES (${negocio}, ${producto}, ${name}, ${sku}, ${barcode}, ${'gid://shopify/ProductVariant/' + name}, 'shopify') RETURNING id`;
      return v.id;
    };
    v38 = await variante('38', null, null);
    v39 = await variante('39', 'YA-EXISTE-39', null);
    v40 = await variante('40', null, '9600000021121');
    // Otro producto con el SKU que se intentará repetir.
    const [o] = await sql<{ id: string }[]>`INSERT INTO products (business_id, name, price) VALUES (${negocio}, 'Otro', 10) RETURNING id`;
    await sql`INSERT INTO product_variants (business_id, product_id, name, sku, barcode) VALUES (${negocio}, ${o.id}, 'U', 'TFW26ZU001NE38', '9600000021114')`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('el siguiente EAN sigue la serie del negocio con su dígito de control', async () => {
    const [estado] = await asUser(sql, catalogo, (tx) => tx`SELECT * FROM public.catalog_codes_status(${negocio})`);
    expect(estado).toMatchObject({ locked: false, can_generate: true, ean_prefix: '9600000' });
    const [r] = await asUser(sql, catalogo, (tx) => tx<{ c: string[] }[]>`SELECT public.next_barcodes(${negocio}, 2) AS c`);
    expect(r.c).toEqual(['960000002113' + checkDigit('960000002113'), '960000002114' + checkDigit('960000002114')]);
    // La vista previa no reserva: se repite.
    const [r2] = await asUser(sql, catalogo, (tx) => tx<{ c: string[] }[]>`SELECT public.next_barcodes(${negocio}, 1) AS c`);
    expect(r2.c[0]).toBe(r.c[0]);
  });

  it('reserva SKU y EAN solo para tallas sin código y nunca los repite', async () => {
    await expect(reservar([{ variant_id: v39, sku: 'NUEVO-39' }])).rejects.toThrow(/ya tiene SKU/);
    await expect(reservar([{ variant_id: v40, barcode: 'auto' }])).rejects.toThrow(/ya tiene código de barras/);
    await expect(reservar([{ variant_id: v38, sku: 'tfw26zu001ne38' }])).rejects.toThrow(/ya existe/);
    await expect(reservar([{ variant_id: v38, sku: 'MAL SKU' }])).rejects.toThrow(/solo puede llevar/);
    await expect(reservar([{ variant_id: v38, sku: 'A1' }, { variant_id: v40, sku: 'a1' }])).rejects.toThrow(/ya existe/);

    const filas = await reservar([
      { variant_id: v38, sku: 'TFW26ZU002NE38', barcode: 'auto' },
      { variant_id: v39, barcode: 'auto' },
      { variant_id: v40, sku: 'TFW26ZU002NE40' },
    ]);
    const esperado1 = '960000002113' + checkDigit('960000002113');
    const esperado2 = '960000002114' + checkDigit('960000002114');
    expect(filas.map((f) => [f.sku, f.barcode])).toEqual([
      ['TFW26ZU002NE38', esperado1],
      ['TFW26ZU002NE40', null],
      [null, esperado2],
    ]);
    expect(filas.every((f) => f.variant_external_id?.startsWith('gid://shopify/ProductVariant/'))).toBe(true);
    // Reservados: no se dan a otra talla aunque el producto aún no los tenga.
    await expect(reservar([{ variant_id: v40, sku: 'TFW26ZU002NE38' }])).rejects.toThrow(/ya existe/);
    const [sig] = await asUser(sql, catalogo, (tx) => tx<{ c: string[] }[]>`SELECT public.next_barcodes(${negocio}, 1) AS c`);
    expect(sig.c[0]).toBe('960000002115' + checkDigit('960000002115'));
    // Reintento (Shopify falló): el mismo SKU vale para la misma talla; el EAN, el siguiente.
    const otra = await reservar([{ variant_id: v38, sku: 'TFW26ZU002NE38', barcode: 'auto' }]);
    expect(otra.map((f) => [f.sku, f.barcode])).toEqual([['TFW26ZU002NE38', sig.c[0]]]);
  });

  it('solo quien edita el catálogo, y nada mientras Stockagile esté conectado', async () => {
    await expect(reservar([{ variant_id: v38, barcode: 'auto' }], staff)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, staff, (tx) => tx`SELECT public.next_barcodes(${negocio}, 1)`)).rejects.toMatchObject(PERMISO_DENEGADO);
    const [e] = await asUser(sql, staff, (tx) => tx`SELECT * FROM public.catalog_codes_status(${negocio})`);
    expect(e.can_generate).toBe(false);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.catalog_codes_status(${negocio})`)).rejects.toMatchObject(PERMISO_DENEGADO);
    await expect(asUser(sql, owner, (tx) => tx`SELECT * FROM catalog_code_reservations`)).rejects.toMatchObject(PERMISO_DENEGADO);

    await sql`INSERT INTO stockagile_connections (business_id) VALUES (${negocio})`;
    const [bloq] = await asUser(sql, catalogo, (tx) => tx`SELECT * FROM public.catalog_codes_status(${negocio})`);
    expect(bloq.locked).toBe(true);
    await expect(reservar([{ variant_id: v38, barcode: 'auto' }], owner)).rejects.toThrow(/Stockagile/);
    await expect(asUser(sql, owner, (tx) => tx`SELECT public.next_barcodes(${negocio}, 1, true)`)).rejects.toThrow(/Stockagile/);
    // La vista previa sigue funcionando.
    const [prev] = await asUser(sql, owner, (tx) => tx<{ c: string[] }[]>`SELECT public.next_barcodes(${negocio}, 1) AS c`);
    expect(prev.c).toHaveLength(1);
  });
});
