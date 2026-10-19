// @vitest-environment node
// Facturas con IVA incluido en el precio (A11 de docs/AUDITORIA.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

describe.skipIf(!RLS_DB_URL)('RLS · facturas: IVA incluido', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let negocio: string;

  const facturar = (items: { description: string; quantity: number; unit_price: number }[]) =>
    asUser(sql, owner, (tx) => tx<{ invoice_id: string; invoice_number: string }[]>`
      SELECT * FROM public.create_invoice_with_items(
        _business_id => ${negocio}, _client_id => NULL, _items => ${sql.json(items)}::jsonb, _due_date => NULL, _notes => NULL)`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('una línea de 100 € con IVA incluido: total 100, base 82,64, IVA 17,36', async () => {
    const [f] = await facturar([{ description: 'Servicio', quantity: 1, unit_price: 100 }]);
    const [inv] = await sql`SELECT subtotal::float, tax::float, total::float FROM invoices WHERE id = ${f.invoice_id}`;
    expect(inv).toEqual({ subtotal: 82.64, tax: 17.36, total: 100 });
    const [li] = await sql`SELECT unit_price::float, total::float FROM invoice_items WHERE invoice_id = ${f.invoice_id}`;
    expect(li).toEqual({ unit_price: 100, total: 100 });
  });

  it('varias líneas: el total es la suma y el desglose cuadra', async () => {
    const [f] = await facturar([
      { description: 'Calcetines', quantity: 2, unit_price: 6 },
      { description: 'Plantilla', quantity: 1, unit_price: 7.99 },
    ]);
    const [inv] = await sql`SELECT subtotal::float, tax::float, total::float FROM invoices WHERE id = ${f.invoice_id}`;
    expect(inv.total).toBe(19.99);
    expect(inv.tax).toBe(3.47);
    expect(inv.subtotal).toBe(16.52);
  });

  it('el tipo por defecto de un negocio nuevo es el 21 %', async () => {
    const [bs] = await sql`SELECT tax_rate::float FROM business_settings WHERE business_id = ${negocio}`;
    expect(bs.tax_rate).toBe(21);
    const [def] = await sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'business_settings' AND column_name = 'tax_rate'`;
    expect(def.column_default).toMatch(/^21/);
  });
});
