// Arnés para probar la RLS y las RPC contra un Postgres real.
// Crea una base de datos temporal, aplica el shim de Supabase y todas las
// migraciones (supabase/migrations y después drizzle/migrations) y ofrece
// ayudantes para ejecutar SQL como un usuario autenticado concreto.
// Se activa con RLS_TEST_DATABASE_URL (URL de administración de un Postgres
// desechable); sin ella los tests de RLS se omiten.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export const RLS_DB_URL = process.env.RLS_TEST_DATABASE_URL;

const ROOT = resolve(__dirname, '../../..');

/** Extensiones que solo existen en Supabase: se neutralizan al aplicar las migraciones. */
const SUPABASE_ONLY_EXTENSION =
  /CREATE EXTENSION (?:IF NOT EXISTS )?"?(pg_net|pg_cron|supabase_vault|pgmq)"?[^;]*;/gi;

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

/** Migraciones en el orden en que se aplican en producción. */
export function migrationFiles(): string[] {
  return [
    ...sqlFiles(join(ROOT, 'supabase/migrations')),
    ...sqlFiles(join(ROOT, 'drizzle/migrations')),
  ];
}

export interface TestDb {
  sql: Sql;
  drop: () => Promise<void>;
}

/** Crea una base de datos nueva con el esquema completo de PYMOVA. */
export async function createTestDb(options: { skip?: (file: string) => boolean } = {}): Promise<TestDb> {
  if (!RLS_DB_URL) throw new Error('Falta RLS_TEST_DATABASE_URL');
  const name = `pymova_rls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(RLS_DB_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const url = new URL(RLS_DB_URL);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });

  await sql.unsafe(readFileSync(join(__dirname, 'shim_supabase.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    if (options.skip?.(file)) continue;
    // Fines de línea LF, como en producción (en Windows git puede dejar CRLF).
    const text = readFileSync(file, 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(SUPABASE_ONLY_EXTENSION, '-- (extensión de Supabase omitida en tests)');
    try {
      await sql.unsafe(text);
    } catch (error) {
      throw new Error(`Error aplicando ${file}: ${(error as Error).message}`);
    }
  }

  return {
    sql,
    drop: async () => {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Crea un usuario de auth (el trigger handle_new_user crea su perfil). */
export async function createUser(sql: Sql, email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  return row.id;
}

/** Ejecuta `fn` en una transacción con el rol y los claims de JWT indicados. */
export async function asRole<T>(
  sql: Sql,
  role: 'authenticated' | 'anon' | 'service_role',
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
  extraClaims: Record<string, unknown> = {},
): Promise<T> {
  return (await sql.begin(async (tx) => {
    const claims = JSON.stringify({ ...(userId ? { sub: userId, role } : { role }), ...extraClaims });
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  })) as T;
}

export const asUser = <T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>) =>
  asRole(sql, 'authenticated', userId, fn);

/** Como asUser, con la sesión de nivel `aal` indicado (verificación en dos pasos). */
export const asUserAal = <T>(sql: Sql, userId: string, aal: 'aal1' | 'aal2', fn: (tx: Tx) => Promise<T>) =>
  asRole(sql, 'authenticated', userId, fn, { aal });

export const asAnon = <T>(sql: Sql, fn: (tx: Tx) => Promise<T>) => asRole(sql, 'anon', null, fn);

/** Como las edge functions con el rol de servicio (sin usuario). */
export const asService = <T>(sql: Sql, fn: (tx: Tx) => Promise<T>) => asRole(sql, 'service_role', null, fn);
