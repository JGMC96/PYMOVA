// @vitest-environment node
// Marketing en equipo (fase 1b): campañas y fechas clave, objetivos, tareas e ideas del personal.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDb, createUser, RLS_DB_URL, type Sql, type TestDb } from './harness';

const PERMISO_DENEGADO = { code: '42501' };
const CLAVE_AJENA = { code: '23503' };
const DUPLICADO = { code: '23505' };

describe.skipIf(!RLS_DB_URL)('RLS · marketing en equipo', () => {
  let db: TestDb;
  let sql: Sql;
  let negocio: string;
  let otroNegocio: string;
  let owner: string;
  let admin: string;
  let personal: string;
  let personal2: string;
  let ajeno: string;

  async function nuevoMiembro(email: string, biz: string, role: string): Promise<string> {
    const user = await createUser(sql, email);
    await sql`INSERT INTO business_members (business_id, user_id, role, is_active) VALUES (${biz}, ${user}, ${role}, true)`;
    return user;
  }

  const nuevoNegocio = async (user: string, nombre: string) => {
    const [b] = await asUser(sql, user, (tx) => tx<{ id: string }[]>`SELECT public.create_business(${nombre}, null) AS id`);
    return b.id;
  };

  const crearCampana = (user: string, biz: string, nombre: string, kind = 'campaign') =>
    asUser(sql, user, (tx) => tx<{ id: string }[]>`
      INSERT INTO marketing_campaigns (business_id, name, kind, starts_on, ends_on)
      VALUES (${biz}, ${nombre}, ${kind}, '2026-11-20', '2026-11-30') RETURNING id`);

  const crearPublicacion = (user: string, biz: string, status: string, extra: { campaign_id?: string } = {}) =>
    asUser(sql, user, (tx) => tx<{ id: string }[]>`
      INSERT INTO marketing_posts (business_id, title, content_type, channels, status, created_by, campaign_id)
      VALUES (${biz}, 'Reel zuecos', 'reel', ARRAY['instagram'], ${status}, ${user}, ${extra.campaign_id ?? null})
      RETURNING id`);

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.sql;
    owner = await createUser(sql, 'owner@ejemplo.test');
    negocio = await nuevoNegocio(owner, 'Zapatería');
    admin = await nuevoMiembro('admin@ejemplo.test', negocio, 'admin');
    personal = await nuevoMiembro('personal@ejemplo.test', negocio, 'staff');
    personal2 = await nuevoMiembro('personal2@ejemplo.test', negocio, 'staff');
    ajeno = await createUser(sql, 'ajeno@ejemplo.test');
    otroNegocio = await nuevoNegocio(ajeno, 'Otra tienda');
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe('campañas y fechas clave', () => {
    it('las crea un administrador y las ve todo el equipo, nadie de fuera', async () => {
      const [c] = await crearCampana(admin, negocio, 'Black Friday 2026');

      const vistas = await asUser(sql, personal, (tx) => tx`SELECT id FROM marketing_campaigns WHERE id = ${c.id}`);
      expect(vistas).toHaveLength(1);
      const deFuera = await asUser(sql, ajeno, (tx) => tx`SELECT id FROM marketing_campaigns WHERE id = ${c.id}`);
      expect(deFuera).toHaveLength(0);
      await expect(asAnon(sql, (tx) => tx`SELECT id FROM marketing_campaigns`)).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('el personal no crea, cambia ni borra campañas', async () => {
      await expect(crearCampana(personal, negocio, 'Campaña del personal')).rejects.toMatchObject(PERMISO_DENEGADO);

      const [c] = await crearCampana(admin, negocio, 'Rebajas');
      const cambiadas = await asUser(sql, personal, (tx) => tx`
        UPDATE marketing_campaigns SET name = 'Otra' WHERE id = ${c.id} RETURNING id`);
      expect(cambiadas).toHaveLength(0);
      const borradas = await asUser(sql, personal, (tx) => tx`
        DELETE FROM marketing_campaigns WHERE id = ${c.id} RETURNING id`);
      expect(borradas).toHaveLength(0);
    });

    it('una fecha clave no se carga dos veces', async () => {
      await crearCampana(admin, negocio, 'Cyber Monday', 'key_date');
      await expect(crearCampana(admin, negocio, 'cyber monday', 'key_date')).rejects.toMatchObject(DUPLICADO);
      // Una campaña normal con el mismo nombre sí se puede.
      await expect(crearCampana(admin, negocio, 'Cyber Monday')).resolves.toHaveLength(1);
    });

    it('la fecha de fin no puede ser anterior a la de inicio', async () => {
      await expect(
        asUser(sql, admin, (tx) => tx`
          INSERT INTO marketing_campaigns (business_id, name, starts_on, ends_on)
          VALUES (${negocio}, 'Al revés', '2026-12-10', '2026-12-01')`),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('una publicación no puede ir a una campaña de otro negocio', async () => {
      const [ajena] = await crearCampana(ajeno, otroNegocio, 'Campaña ajena');
      await expect(crearPublicacion(admin, negocio, 'draft', { campaign_id: ajena.id })).rejects.toMatchObject(
        CLAVE_AJENA,
      );
    });

    it('al borrar una campaña, sus publicaciones se quedan sin campaña', async () => {
      const [c] = await crearCampana(admin, negocio, 'Navidad');
      const [p] = await crearPublicacion(admin, negocio, 'draft', { campaign_id: c.id });

      await asUser(sql, admin, (tx) => tx`DELETE FROM marketing_campaigns WHERE id = ${c.id}`);
      const [fila] = await sql<{ campaign_id: string | null; business_id: string }[]>`
        SELECT campaign_id, business_id FROM marketing_posts WHERE id = ${p.id}`;
      expect(fila).toEqual({ campaign_id: null, business_id: negocio });
    });

    it('acepta los tipos nuevos de publicación (carrusel y email)', async () => {
      for (const tipo of ['carousel', 'email']) {
        await expect(
          asUser(sql, admin, (tx) => tx`
            INSERT INTO marketing_posts (business_id, title, content_type, channels, status, created_by)
            VALUES (${negocio}, 'Nuevo tipo', ${tipo}, ARRAY['email'], 'draft', ${admin}) RETURNING id`),
        ).resolves.toHaveLength(1);
      }
    });
  });

  describe('objetivos', () => {
    it('los crea un administrador; el personal los ve pero no los cambia', async () => {
      const [g] = await asUser(sql, admin, (tx) => tx<{ id: string }[]>`
        INSERT INTO marketing_goals (business_id, title, metric, target, starts_on, ends_on)
        VALUES (${negocio}, 'Ventas Black Friday', 'sales', 15000, '2026-11-27', '2026-11-30') RETURNING id`);

      const vistos = await asUser(sql, personal, (tx) => tx`SELECT id FROM marketing_goals WHERE id = ${g.id}`);
      expect(vistos).toHaveLength(1);
      const cambiados = await asUser(sql, personal, (tx) => tx`
        UPDATE marketing_goals SET current = 99999 WHERE id = ${g.id} RETURNING id`);
      expect(cambiados).toHaveLength(0);
      await expect(
        asUser(sql, personal, (tx) => tx`
          INSERT INTO marketing_goals (business_id, title, metric, target, starts_on, ends_on)
          VALUES (${negocio}, 'Mío', 'followers', 100, '2026-11-01', '2026-11-30')`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('la meta tiene que ser mayor que cero', async () => {
      await expect(
        asUser(sql, admin, (tx) => tx`
          INSERT INTO marketing_goals (business_id, title, metric, target, starts_on, ends_on)
          VALUES (${negocio}, 'Sin meta', 'reach', 0, '2026-11-01', '2026-11-30')`),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('ideas del personal', () => {
    it('el personal apunta ideas, pero no programa ni publica', async () => {
      await expect(crearPublicacion(personal, negocio, 'idea')).resolves.toHaveLength(1);
      await expect(crearPublicacion(personal, negocio, 'scheduled')).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('cambia y borra sus ideas mientras sigan siendo idea', async () => {
      const [p] = await crearPublicacion(personal, negocio, 'idea');

      const cambiadas = await asUser(sql, personal, (tx) => tx`
        UPDATE marketing_posts SET title = 'Reel zuecos v2' WHERE id = ${p.id} RETURNING id`);
      expect(cambiadas).toHaveLength(1);
      await expect(
        asUser(sql, personal, (tx) => tx`UPDATE marketing_posts SET status = 'scheduled' WHERE id = ${p.id}`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);

      const borradas = await asUser(sql, personal, (tx) => tx`DELETE FROM marketing_posts WHERE id = ${p.id} RETURNING id`);
      expect(borradas).toHaveLength(1);
    });

    it('no toca las ideas de otros ni las que ya están en marcha', async () => {
      const [deOtra] = await crearPublicacion(personal2, negocio, 'idea');
      const [enMarcha] = await crearPublicacion(personal, negocio, 'idea');
      await asUser(sql, admin, (tx) => tx`UPDATE marketing_posts SET status = 'draft' WHERE id = ${enMarcha.id}`);

      for (const id of [deOtra.id, enMarcha.id]) {
        const cambiadas = await asUser(sql, personal, (tx) => tx`
          UPDATE marketing_posts SET title = 'Cambio' WHERE id = ${id} RETURNING id`);
        expect(cambiadas).toHaveLength(0);
        const borradas = await asUser(sql, personal, (tx) => tx`DELETE FROM marketing_posts WHERE id = ${id} RETURNING id`);
        expect(borradas).toHaveLength(0);
      }
    });

    it('no apunta ideas en nombre de otra persona ni en otro negocio', async () => {
      await expect(
        asUser(sql, personal, (tx) => tx`
          INSERT INTO marketing_posts (business_id, title, content_type, channels, status, created_by)
          VALUES (${negocio}, 'Suplantada', 'post', ARRAY['instagram'], 'idea', ${personal2})`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(crearPublicacion(personal, otroNegocio, 'idea')).rejects.toMatchObject(PERMISO_DENEGADO);
    });
  });

  describe('tareas', () => {
    const crearTarea = (assignee: string | null) =>
      asUser(sql, admin, (tx) => tx<{ id: string }[]>`
        INSERT INTO marketing_tasks (business_id, title, assignee_id, due_on)
        VALUES (${negocio}, 'Grabar reel', ${assignee}, '2026-11-20') RETURNING id`);

    const marcar = (user: string, id: string, hecha: boolean) =>
      asUser(sql, user, (tx) => tx`SELECT public.set_marketing_task_done(${id}, ${hecha})`);

    it('las crea un administrador; el personal no las crea ni las cambia a mano', async () => {
      const [t] = await crearTarea(personal);
      await expect(
        asUser(sql, personal, (tx) => tx`
          INSERT INTO marketing_tasks (business_id, title) VALUES (${negocio}, 'Mía')`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
      const cambiadas = await asUser(sql, personal, (tx) => tx`
        UPDATE marketing_tasks SET done_at = now() WHERE id = ${t.id} RETURNING id`);
      expect(cambiadas).toHaveLength(0);
    });

    it('la persona responsable la marca como hecha y la desmarca', async () => {
      const [t] = await crearTarea(personal);

      await marcar(personal, t.id, true);
      let [fila] = await sql<{ done_at: Date | null; done_by: string | null }[]>`
        SELECT done_at, done_by FROM marketing_tasks WHERE id = ${t.id}`;
      expect(fila.done_at).not.toBeNull();
      expect(fila.done_by).toBe(personal);

      await marcar(personal, t.id, false);
      [fila] = await sql<{ done_at: Date | null; done_by: string | null }[]>`
        SELECT done_at, done_by FROM marketing_tasks WHERE id = ${t.id}`;
      expect(fila).toEqual({ done_at: null, done_by: null });
    });

    it('otra persona del personal no la marca; un administrador sí', async () => {
      const [t] = await crearTarea(personal);
      await expect(marcar(personal2, t.id, true)).rejects.toMatchObject(PERMISO_DENEGADO);
      await expect(marcar(admin, t.id, true)).resolves.toBeDefined();
    });

    it('nadie de fuera la marca ni la ve, y anon no llama a la función', async () => {
      const [t] = await crearTarea(personal);
      await expect(marcar(ajeno, t.id, true)).rejects.toMatchObject(PERMISO_DENEGADO);
      const vistas = await asUser(sql, ajeno, (tx) => tx`SELECT id FROM marketing_tasks WHERE id = ${t.id}`);
      expect(vistas).toHaveLength(0);
      await expect(
        asAnon(sql, (tx) => tx`SELECT public.set_marketing_task_done(${t.id}, true)`),
      ).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('una tarea no puede colgar de una publicación de otro negocio', async () => {
      const [ajena] = await crearPublicacion(ajeno, otroNegocio, 'draft');
      await expect(
        asUser(sql, admin, (tx) => tx`
          INSERT INTO marketing_tasks (business_id, title, post_id) VALUES (${negocio}, 'Cruzada', ${ajena.id})`),
      ).rejects.toMatchObject(CLAVE_AJENA);
    });
  });

  it('la migración se puede aplicar dos veces', async () => {
    // Se busca por el final del nombre: el número lo pone la fila de migraciones (y Lovable lo repite).
    const dir = resolve(__dirname, '../../../drizzle/migrations');
    const file = readdirSync(dir).find((f) => f.endsWith('_marketing_campanas.sql'));
    expect(file).toBeDefined();
    await sql.unsafe(readFileSync(resolve(dir, file!), 'utf8').replace(/\r\n/g, '\n'));
    const [r] = await sql`
      SELECT (SELECT count(*)::int FROM pg_policies WHERE tablename = 'marketing_posts') AS politicas,
             has_function_privilege('anon', 'public.set_marketing_task_done(uuid, boolean)', 'EXECUTE') AS anon`;
    expect(r).toEqual({ politicas: 7, anon: false });
  });
});
