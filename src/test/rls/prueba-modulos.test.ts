// @vitest-environment node
// Plan de prueba con todos los módulos que vende la web (TPV, RR. HH. y marketing).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDb, createUser, migrationFiles, RLS_DB_URL, type Sql, type TestDb } from './harness';

const MIGRACION = '_prueba_con_todos_los_modulos.sql';
const NUEVOS = ['hr', 'marketing', 'retail'];

const crearNegocio = (sql: Sql, userId: string, nombre: string) =>
  asUser(sql, userId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`SELECT public.create_business(${nombre}, 'retail') AS id`;
    return row.id;
  });

const modulos = (sql: Sql, businessId: string) =>
  sql<{ key: string; is_enabled: boolean }[]>`
    SELECT m.key, bm.is_enabled
    FROM business_modules bm JOIN modules m ON m.id = bm.module_id
    WHERE bm.business_id = ${businessId}
    ORDER BY m.key`;

const activos = async (sql: Sql, businessId: string) =>
  (await modulos(sql, businessId)).filter((m) => m.is_enabled).map((m) => m.key);

describe.skipIf(!RLS_DB_URL)('RLS · prueba con todos los módulos', () => {
  let db: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('un negocio nuevo arranca la prueba con TPV, RR. HH. y marketing', async () => {
    const userId = await createUser(sql, 'prueba@ejemplo.test');
    const id = await crearNegocio(sql, userId, 'Tienda en prueba');

    const [sub] = await sql`
      SELECT s.status, p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ${id}`;
    expect(sub).toMatchObject({ status: 'trialing', key: 'trial' });

    expect(await activos(sql, id)).toEqual(
      ['clients', 'hr', 'invoicing', 'marketing', 'payments', 'products', 'retail'],
    );
  });
});

describe.skipIf(!RLS_DB_URL)('RLS · prueba con todos los módulos (negocios que ya estaban en prueba)', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let aplicar: () => Promise<unknown>;

  beforeAll(async () => {
    // Esquema de antes de la migración, con un negocio ya en prueba
    db = await createTestDb({ skip: (f) => f.endsWith(MIGRACION) });
    sql = db.sql;
    const file = migrationFiles().find((f) => f.endsWith(MIGRACION));
    if (!file) throw new Error(`No se encuentra la migración *${MIGRACION}`);
    const texto = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    aplicar = () => sql.unsafe(texto);

    const userId = await createUser(sql, 'antiguo@ejemplo.test');
    negocio = await crearNegocio(sql, userId, 'Tienda antigua');
    // El super admin había apagado RR. HH. en este negocio
    await sql`
      INSERT INTO business_modules (business_id, module_id, is_enabled, limits)
      SELECT ${negocio}, id, false, '{}'::jsonb FROM modules WHERE key = 'hr'`;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('antes de la migración la prueba no traía el TPV', async () => {
    expect(await activos(sql, negocio)).toEqual(['clients', 'invoicing', 'payments', 'products']);
  });

  it('la migración activa lo nuevo, respeta lo apagado a mano y se puede repetir', async () => {
    await aplicar();
    await aplicar();

    const filas = await modulos(sql, negocio);
    expect(filas.filter((m) => NUEVOS.includes(m.key))).toEqual([
      { key: 'hr', is_enabled: false },
      { key: 'marketing', is_enabled: true },
      { key: 'retail', is_enabled: true },
    ]);
    expect(new Set(filas.map((m) => m.key)).size).toBe(filas.length);

    const [plan] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM plan_modules pm
      JOIN plans p ON p.id = pm.plan_id JOIN modules m ON m.id = pm.module_id
      WHERE p.key = 'trial' AND m.key IN ('hr', 'marketing', 'retail')`;
    expect(plan.n).toBe(3);
  });
});
