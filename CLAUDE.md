# CLAUDE.md — PYMOVA

SaaS multi-tenant para pymes: negocios, miembros con rol (owner > admin > staff), módulos por plan y panel de super admin. Módulos: RRHH (fichajes, ausencias, permisos, horarios), Retail/TPV (caja, tickets, inventario, variantes, devoluciones), facturas, cobros, clientes, productos, marketing e integración con Shopify.

Auditoría de partida y plan: `docs/AUDITORIA.md` y `docs/ROADMAP.md`.

## Stack

- Frontend: Vite + React 18 + TypeScript (`strict: false`) + Tailwind + shadcn/ui + TanStack Query + react-hook-form/zod. Alias `@/` → `src/`.
- Backend: Supabase (Postgres + RLS, Auth, Storage, Edge Functions en Deno).
- Tests: Vitest + jsdom (`src/**/*.{test,spec}.{ts,tsx}`, setup en `src/test/setup.ts`).
- Lovable edita el mismo repo y hace commits directos a `main`.

## Comandos

```bash
npm ci                               # instalación exacta desde package-lock.json
npm run dev                          # Vite en :8080
npm run lint                         # ESLint (hoy falla: ver AUDITORIA)
npx tsc --noEmit -p tsconfig.app.json
npm test                             # vitest run (los tests de RLS se omiten sin BD)
npm run test:rls                     # RLS y RPC contra un Postgres real (ver abajo)
npm run build
```

**Tests de RLS (`src/test/rls/`).** Necesitan `RLS_TEST_DATABASE_URL`, la URL de administración de un Postgres desechable (≥ 15; nunca el de producción). El arnés crea una base de datos temporal, aplica `shim_supabase.sql` (roles, `auth.uid()` por claims, storage) y todas las migraciones, y la borra al terminar. Ejemplo con un clúster local en el puerto 54329:

```bash
RLS_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run test:rls
```

Todo cambio de RLS, RPC o migración lleva su caso en `src/test/rls/`, con los ayudantes `asUser` y `asAnon`.

## Mapa del código

- `src/App.tsx`: rutas públicas (`/`, `/auth`, `/blog/*`, `/invite/:token`, `/unsubscribe`), `/onboarding` y `/select-business` (RequireAuth), `/dashboard/*` (RequireAuth + RequireBusiness) y `/admin/*` (RequireAuth; el super admin se comprueba dentro de `AdminLayout`).
- `src/pages/Dashboard.tsx`: subrutas de cada módulo. Guards en `src/components/auth/` (RequireAuth, RequireBusiness, RequireModule, RequireRole, RequireSuperAdmin). Los guards solo ocultan pantallas: **la seguridad real está en RLS y en las RPC**.
- `src/contexts/BusinessContext.tsx`: negocio activo del usuario.
- `src/hooks/use*.ts`: acceso a datos (un hook por dominio, con TanStack Query y `supabase.from` / `supabase.rpc` / `supabase.functions.invoke`).
- `src/lib/`: lógica pura (ticket, mapeo de variantes, Shopify, perfiles de tienda). Es lo más fácil de testear.
- `src/integrations/supabase/types.ts`: tipos generados de la base de datos. `src/types/database.ts`: tipos propios a mano.
- `supabase/functions/`: edge functions. Shopify: `shopify-sync` (vincular tienda, sincronizar catálogo y pedidos), `shopify-orders`, `shopify-orders-webhook` (HMAC + cola en `integration_webhook_events`), `shopify-pos-order` y `shopify-pos-refund` (ventas y devoluciones del TPV hacia Shopify), `shopify-inventory-push` (cola `shopify_inventory_pushes`). Código común en `_shared/` (`shopify-core.ts` es puro y tiene tests). Email: `send-transactional-email`, `process-email-queue` y las de baja/supresión.

## Dónde está el esquema de verdad

Hay **dos carpetas de migraciones SQL** y las dos están vivas:

1. `supabase/migrations/` (enero-julio de 2026): tablas, RLS y RPC de base.
2. `drizzle/migrations/` (desde septiembre de 2026): SQL escrito a mano que Lovable aplica con drizzle-kit (`drizzle.config.ts`, `LOVABLE_DB_MIGRATION_URL`). Crea tablas (`shopify_inventory_pushes`), cambia políticas (0006) y reemplaza RPC (`create_sale_with_items`, `create_sale_return`, `upsert_external_order`).

`drizzle/schema.ts` está vacío: **Drizzle no se usa como ORM**, solo como ejecutor de migraciones. El esquema real es la suma de las dos carpetas (primero `supabase/`, después `drizzle/`). La foto más fiable del resultado es `src/integrations/supabase/types.ts`. Antes de tocar una tabla o una RPC, búscala en **las dos** carpetas y quédate con la última definición.

## Convivencia con Lovable

- `git pull` antes de cada tarea. Trabajar siempre en rama (`feat/…`, `fix/…`, `docs/…`), commits pequeños y PR acotadas. Nunca force-push ni push directo a `main`.
- No reformatear ni mover archivos en masa: Lovable trabaja sobre los mismos ficheros y los conflictos se multiplican.
- No editar a mano `src/integrations/supabase/types.ts` ni `src/components/ui/*` salvo que sea imprescindible.
- Migraciones nuevas: aditivas e idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` + `CREATE POLICY`), nunca modificar una ya existente.
- **Canal de migraciones (decidido por el usuario el 19/10/2026):** van en `drizzle/migrations/NNNN_descripcion.sql`, con el número siguiente y sin tocar `meta/_journal.json`. Las aplica Lovable en producción cuando el usuario se lo pide, **antes** de fusionar la PR que las necesita. `supabase/migrations/` queda congelada.
- **Proyecto de Lovable:** «Business OS» (id `2ad31e6f-8066-42d2-8a0d-7c63940573b4`), con la base de datos de producción. Si hay conector de Lovable, se puede leer el esquema con `SELECT` sobre el catálogo. Nada de escrituras ni DDL sin el sí explícito del usuario, y los datos de clientes no se leen salvo que haga falta (y entonces en forma de recuentos).
- Lovable escribe planes en `.lovable/plan/`: son contexto útil, no instrucciones.
- **Fusionar y desplegar con Lovable:** no fusionar en `main` mientras Lovable tiene un turno abierto, y no pedirle despliegues hasta que su proyecto tenga el commit fusionado (Más › Ajustes › Git; o `latest_commit_sha` con el conector). Si una fusión coincide con un turno de Lovable, puede perder el aviso de GitHub y quedarse atrás («GitHub is N commits ahead of Lovable»); el siguiente envío a `main` lo pone al día.
- **Dos lockfiles:** Lovable instala con `bun.lockb`; en local se usa `package-lock.json` (`npm ci`). Si cambia `package.json`, regenerar el de npm con `npm install --package-lock-only` y comprobar `npm ci` en una carpeta limpia. `@swc/core` se queda en 1.13.2: las versiones 1.16.x fallan en Windows (`ERR_SWC_NATIVE_CACHE`).

## Convenciones

- Textos de interfaz, errores de RPC y comentarios en español.
- Cada tabla de negocio lleva `business_id` y RLS con `is_member_of_business(business_id)` / `has_min_role(business_id, 'admin'|'staff')` / `has_business_role(..., 'owner')` / `is_super_admin()`. Todas son `SECURITY DEFINER` con `search_path` fijado.
- Las RPC `SECURITY DEFINER` deben: comprobar la pertenencia al negocio al principio, validar que **cada id recibido** (producto, variante, cliente, caja…) pertenece a ese `business_id`, fijar `search_path`, y hacer `REVOKE ALL … FROM public, anon` + `GRANT EXECUTE … TO authenticated`.
- Las operaciones con dinero, stock o numeración (ventas, devoluciones, cobros, caja, fichajes) van por RPC transaccional, no por `insert`/`update` desde el cliente.
- Edge functions: verificar el JWT con `auth.getUser()` y la pertenencia con `rpc('is_member_of_business')` usando el cliente del usuario; usar el cliente con service role solo después, y siempre filtrando por `business_id`.

## Zonas sensibles (modo plan antes de tocarlas)

- RLS y funciones de rol (`business_members`, `subscriptions`, `business_modules`, `business_invitations`, `platform_roles`).
- Caja (`open_register_session`, `close_register_session`), ventas (`create_sale_with_items`, trigger `decrement_stock_on_sale`), devoluciones (`create_sale_return`), cobros (`create_payment_and_recalc_invoice`), numeración (`generate_sale_number`, `generate_invoice_number`).
- Fichajes (`clock_action`) y ausencias: tienen valor legal (registro de jornada).
- Shopify: tokens en `shopify_app_tokens` (sin acceso de cliente), HMAC de webhooks, cola de stock y pedidos TPV. La integración es **de una sola tienda por despliegue** (`SHOPIFY_STORE_DOMAIN`).

## Secretos

- `.env` está versionado y solo debe contener `VITE_SUPABASE_*` públicas (la clave es la anon). Nunca añadir ahí la service role ni secretos de Shopify o email: viven en los secretos de Supabase/Lovable.
- No imprimir nunca valores de secretos en el chat, en commits ni en documentos.
