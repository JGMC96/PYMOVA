// @vitest-environment node
// 0063: cobrar en el TPV los vales de Stockagile. El vale se convierte una sola vez en vale de
// PYMOVA con su saldo en la copia (cargas − gastos), sin caducidad; después se gasta como
// cualquier vale. Si Stockagile lo gasta después de convertirlo, queda marcado.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const DENEGADO = { code: '42501' };
const NO_VALIDO = { code: '22023' };
const IVA = 21;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Vale {
  id: string;
  code: string;
  initial_amount: string;
  balance: string;
  status: string;
  expires_at: Date | null;
  expired: boolean;
  stockagile_ticket: string | null;
  issued_at: Date | null;
  conflict_at: Date | null;
  converted_now: boolean;
}

describe.skipIf(!RLS_DB_URL)('RLS · vales de Stockagile en el TPV', () => {
  let db: TestDb;
  let sql: Sql;
  let owner: string;
  let staff: string;
  let ajeno: string;
  let negocio: string;
  let otroNegocio: string;
  let producto: string;
  let caja: string;
  let ana: string;
  let externo = 5000;

  /** Ticket de Stockagile con sus líneas de vale; devuelve su id. */
  const ticket = async (
    numero: string,
    lineas: { total: number; carga?: number; gasto?: number; codigo?: string }[],
    opts: { negocio?: string; devolucion?: boolean; dias?: number; borrado?: boolean; email?: string | null } = {},
  ) => {
    const [s] = await sql<{ id: string }[]>`
      INSERT INTO stockagile_sales (business_id, external_id, number, sold_at, total, is_return, deleted, customer_email)
      VALUES (${opts.negocio ?? negocio}, ${externo++}, ${numero}, now() - make_interval(days => ${opts.dias ?? 30}), 0,
              ${opts.devolucion ?? true}, ${opts.borrado ?? false}, ${opts.email ?? null})
      RETURNING id`;
    for (const l of lineas) {
      await sql`
        INSERT INTO stockagile_sale_items (sale_id, product_name, quantity, total, gift_card_code, gift_card_charged_id, gift_card_consumed_id)
        VALUES (${s.id}, 'Vale', 1, ${l.total}, ${l.codigo ?? `nd2.${numero}`}, ${l.carga ?? null}, ${l.gasto ?? null})`;
    }
    return s.id;
  };

  const canjear = (codigo: string, user = staff, b = negocio) =>
    asUser(sql, user, (tx) => tx<Vale[]>`SELECT * FROM public.redeem_stockagile_voucher(${b}, ${codigo})`).then((r) => r[0]);

  const vender = async (vale: string, importeVale: number, total = 100) => {
    const base = r2(total / (1 + IVA / 100));
    const items = [{ product_id: producto, variant_id: null, product_name: 'Zueco', quantity: 1, unit_price: total, total }];
    const [r] = await asUser(sql, staff, (tx) => tx<{ sale_id: string }[]>`
      SELECT * FROM public.create_sale_with_items(
        _business_id => ${negocio}, _items => ${sql.json(items as never)}::jsonb, _payment_method => 'card',
        _subtotal => ${base}, _tax => ${r2(total - base)}, _total => ${total}, _discount => 0,
        _register_session_id => ${caja}, _voucher_code => ${vale}, _voucher_amount => ${importeVale})`);
    return r.sale_id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    staff = await createUser(sql, 'tienda@ejemplo.test');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    const [b] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Tienda', null) AS id`);
    negocio = b.id;
    const [o] = await asUser(sql, ajeno, (tx) => tx<{ id: string }[]>`SELECT public.create_business('Otra', null) AS id`);
    otroNegocio = o.id;
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${negocio}, ${staff}, 'staff', true)`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (business_id, name, price, stock_quantity, track_inventory) VALUES (${negocio}, 'Zueco', 100, 100, true) RETURNING id`;
    producto = p.id;
    const [c] = await asUser(sql, owner, (tx) => tx<{ id: string }[]>`SELECT public.open_register_session(${negocio}, 50) AS id`);
    caja = c.id;
    const [cl] = await sql<{ id: string }[]>`INSERT INTO clients (business_id, name, email) VALUES (${negocio}, 'Ana', 'ana@ejemplo.test') RETURNING id`;
    ana = cl.id;

    // Tarjeta 11: emitida al devolver (144 €, de Ana) y gastada en parte (109 €) → 35 €.
    await ticket('VT100001', [{ total: 144, carga: 11 }], { dias: 400, email: 'ana@ejemplo.test' });
    await ticket('VT100002', [{ total: -109, gasto: 11, codigo: 'nd2.VT100001' }], { devolucion: false, dias: 300 });
    // Tarjeta 12: sin gastar (50 €). Tarjeta 13: gastada entera. Tarjeta 14: un gasto en un ticket borrado no cuenta.
    await ticket('VT100003', [{ total: 50, carga: 12 }]);
    await ticket('VT100004', [{ total: 80, carga: 13 }]);
    await ticket('VT100005', [{ total: -80, gasto: 13, codigo: 'nd2.VT100004' }], { devolucion: false });
    await ticket('VT100006', [{ total: 60, carga: 14 }]);
    await ticket('VT100007', [{ total: -60, gasto: 14, codigo: 'nd2.VT100006' }], { devolucion: false, borrado: true });
    // Tarjeta 15: solo un gasto en la copia (sin carga). La tarjeta 16 es de otro negocio.
    await ticket('VT100008', [{ total: -90, gasto: 15, codigo: 'nd2.VT099999' }], { devolucion: false });
    await ticket('VT100009', [{ total: 70, carga: 16 }], { negocio: otroNegocio });
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('la migración se puede aplicar otra vez', async () => {
    await sql.unsafe(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0063_0063_vales_stockagile_tpv.sql'), 'utf8'));
    const [k] = await sql<{ k: string }[]>`SELECT public.stockagile_voucher_key('nd2.VT100003') AS k`;
    expect(k.k).toBe('VT100003');
  });

  it('convierte el vale con lo que le queda, de su clienta y sin caducidad', async () => {
    const v = await canjear('nd2.VT100001');
    expect(v).toMatchObject({ code: 'ND2.VT100001', status: 'active', expires_at: null, expired: false, stockagile_ticket: 'VT100001', converted_now: true, conflict_at: null });
    expect([Number(v.initial_amount), Number(v.balance)]).toEqual([35, 35]);
    const [row] = await sql<{ origin: string; client_id: string; stockagile_gift_card_id: string }[]>`
      SELECT origin, client_id, stockagile_gift_card_id FROM store_vouchers WHERE id = ${v.id}`;
    expect(row).toEqual({ origin: 'import', client_id: ana, stockagile_gift_card_id: '11' });
    const movs = await sql<{ kind: string; amount: number; note: string }[]>`
      SELECT kind, amount::float AS amount, note FROM store_voucher_movements WHERE voucher_id = ${v.id}`;
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ kind: 'import', amount: 35 });
    expect(movs[0].note).toContain('VT100001');
  });

  it('una segunda vez, con otro formato, devuelve el mismo vale y no crea otro', async () => {
    const a = await canjear('ND2-vt100003');
    const b = await canjear('VT100003');
    const c = await canjear('100003');
    expect(a.converted_now).toBe(true);
    expect([b.converted_now, c.converted_now]).toEqual([false, false]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM store_vouchers WHERE stockagile_gift_card_id = 12`;
    expect(n.n).toBe(1);
    // También lo encuentra la búsqueda normal de vales.
    const [g] = await asUser(sql, staff, (tx) => tx<{ id: string }[]>`SELECT id FROM public.get_store_voucher(${negocio}, 'nd2.vt100003')`);
    expect(g.id).toBe(a.id);
  });

  it('dos cajas a la vez: un solo vale', async () => {
    const [x, y] = await Promise.all([canjear('nd2.VT100006'), canjear('nd2.VT100006')]);
    expect(x.id).toBe(y.id);
    expect([x.converted_now, y.converted_now].filter(Boolean)).toHaveLength(1);
    expect(Number(x.balance)).toBe(60); // el gasto del ticket borrado no cuenta
  });

  it('gastado, sin carga, desconocido o de otro negocio: no se convierte', async () => {
    await expect(canjear('nd2.VT100004')).rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('ya está gastado') });
    await expect(canjear('nd2.VT099999')).rejects.toMatchObject({ ...NO_VALIDO, message: expect.stringContaining('No hay ningún vale') });
    await expect(canjear('nd2.VT777777')).rejects.toMatchObject(NO_VALIDO);
    await expect(canjear('nd2.VT100009')).rejects.toMatchObject(NO_VALIDO);
    await expect(canjear('   ')).rejects.toMatchObject(NO_VALIDO);
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM store_vouchers WHERE stockagile_gift_card_id IN (13, 15, 16)`;
    expect(n.n).toBe(0);
  });

  it('solo los miembros del negocio', async () => {
    await expect(canjear('nd2.VT100009', ajeno, negocio)).rejects.toMatchObject(DENEGADO);
    await expect(asAnon(sql, (tx) => tx`SELECT * FROM public.redeem_stockagile_voucher(${negocio}, 'nd2.VT100003')`)).rejects.toMatchObject(DENEGADO);
    const [f] = await sql<{ auth: boolean; anon: boolean; trig_auth: boolean }[]>`
      SELECT has_function_privilege('authenticated', 'public.redeem_stockagile_voucher(uuid, text)', 'EXECUTE') AS auth,
             has_function_privilege('anon', 'public.redeem_stockagile_voucher(uuid, text)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.stockagile_voucher_conflict()', 'EXECUTE') AS trig_auth`;
    expect(f).toEqual({ auth: true, anon: false, trig_auth: false });
  });

  it('se paga con él como con cualquier vale: en parte y luego el resto', async () => {
    const v = await canjear('nd2.VT100001');
    await vender(v.code, 20);
    let [s] = await sql<{ balance: string; status: string }[]>`SELECT balance, status FROM store_vouchers WHERE id = ${v.id}`;
    expect([Number(s.balance), s.status]).toEqual([15, 'active']);
    await vender('nd2.vt100001', 15);
    [s] = await sql<{ balance: string; status: string }[]>`SELECT balance, status FROM store_vouchers WHERE id = ${v.id}`;
    expect([Number(s.balance), s.status]).toEqual([0, 'used']);
    // Ya gastado en PYMOVA: canjear otra vez lo devuelve sin saldo, no lo rehace con la copia.
    const otra = await canjear('nd2.VT100001');
    expect([otra.id, Number(otra.balance), otra.converted_now]).toEqual([v.id, 0, false]);
  });

  it('si Stockagile lo gasta después de convertirlo, queda marcado; lo de antes no cuenta', async () => {
    const v = await canjear('nd2.VT100003');
    expect(v.conflict_at).toBeNull();
    // La copia rehace un ticket antiguo de esa tarjeta: no es un conflicto.
    await ticket('VT100010', [{ total: -1, gasto: 12, codigo: 'nd2.VT100003' }], { devolucion: false, dias: 5 });
    expect((await canjear('VT100003')).conflict_at).toBeNull();
    // Un gasto nuevo en Stockagile sí.
    await ticket('VT100011', [{ total: -10, gasto: 12, codigo: 'nd2.VT100003' }], { devolucion: false, dias: -1 });
    const marcado = await canjear('VT100003');
    expect(marcado.conflict_at).not.toBeNull();
    expect(Number(marcado.balance)).toBe(50); // no toca el saldo: solo avisa
  });

  it('la cuenta del usuario no puede cambiar a mano la tarjeta ni el aviso', async () => {
    await expect(asUser(sql, owner, (tx) => tx`
      UPDATE store_vouchers SET stockagile_conflict_at = NULL, stockagile_gift_card_id = 99 WHERE business_id = ${negocio}`)).rejects.toMatchObject(DENEGADO);
  });
});
