# Calendario de Marketing

Nuevo módulo dentro del dashboard para que el equipo planifique y vea las publicaciones de Instagram y Facebook (historia, post, reel). Todos los miembros del negocio ven el calendario; solo `owner` y `admin` pueden crear, editar y eliminar.

## Experiencia de usuario

- Nueva entrada **"Marketing"** en el sidebar (con icono calendario), gated por el módulo `marketing` igual que el resto.
- Ruta `/dashboard/marketing` con dos vistas:
  - **Calendario mensual** (default): grid tipo Google Calendar con chips de publicaciones por día, color por tipo (historia / post / reel) e icono por canal (IG / FB).
  - **Lista / agenda**: tabla filtrable por rango, tipo, canal, estado y responsable.
- Filtros superiores: tipo, canal, estado, responsable, rango de fechas.
- Click en un día vacío → diálogo "Nueva publicación" prellenado con esa fecha.
- Click en una publicación → diálogo de detalle con edición inline (solo admin/owner; staff ve en modo lectura).
- Estados del workflow simple: `idea`, `borrador`, `programado`, `publicado`, `cancelado`. Badge de color.
- Campos del formulario:
  - Título, descripción/copy, tipo (historia/post/reel), canales (IG, FB, ambos), fecha y hora programada, estado, responsable (miembro del negocio), URL de referencia/asset, notas internas, hashtags.

## Modelo de datos

Tabla `marketing_posts` aislada por `business_id` con RLS:

```text
marketing_posts
  id uuid pk
  business_id uuid fk businesses
  title text
  copy text
  content_type text   -- 'story' | 'post' | 'reel'
  channels text[]     -- ['instagram','facebook']
  status text         -- 'idea'|'draft'|'scheduled'|'published'|'cancelled'
  scheduled_at timestamptz
  assignee_id uuid    -- profiles.id (nullable)
  reference_url text
  hashtags text
  notes text
  created_by uuid
  created_at, updated_at
```

- Índices: `(business_id, scheduled_at)`, `(business_id, status)`.
- Trigger `update_updated_at_column`.
- Trigger `audit_log_changes` (igual que clients/invoices) para trazabilidad.

### RLS

- `SELECT`: `is_member_of_business(business_id)` — todo el equipo ve.
- `INSERT` / `UPDATE` / `DELETE`: `has_min_role(business_id, 'admin')` — solo owner/admin gestionan.
- GRANTs estándar a `authenticated` y `service_role`.

### Catálogo de módulo

- Insertar `modules` row con `key='marketing'`, nombre "Calendario de marketing".
- Asociar a planes `pro` y `business` vía `plan_modules` (free/trial quedan bloqueados → muestra `LockedModulePage` igual que el resto).

## Frontend

Archivos nuevos:

```text
src/types/database.ts                       -- añadir tipo MarketingPost y ModuleKey 'marketing'
src/hooks/useMarketingPosts.ts              -- fetch + create/update/delete con requestIdRef
src/pages/dashboard/Marketing.tsx           -- contenedor con tabs Calendario / Lista
src/components/marketing/MarketingHeader.tsx
src/components/marketing/MarketingCalendar.tsx   -- grid mensual (sin libs nuevas, usa date-fns ya disponible)
src/components/marketing/MarketingList.tsx       -- tabla/agenda
src/components/marketing/PostFormDialog.tsx      -- crear/editar (admin/owner)
src/components/marketing/PostDetailDialog.tsx    -- ver/editar
src/components/marketing/PostBadge.tsx           -- chip tipo+canal+estado
```

Cambios:

- `src/components/dashboard/DashboardSidebar.tsx`: añadir item Marketing con `moduleKey: 'marketing'` e icono `CalendarDays`.
- `src/pages/Dashboard.tsx` (router del dashboard): nueva ruta `marketing` envuelta en `RequireModule` y `RequireRole` solo para mutaciones (lectura abierta a todos).
- Usar `useRoleAccess` para ocultar/disable botones de crear/editar/eliminar en staff.

## Detalles técnicos clave

- Todas las queries filtran por `business_id` activo (regla core).
- Hook `useMarketingPosts` con `requestIdRef` para evitar race conditions, igual patrón que `useClients` / `useInvoices`.
- Calendario implementado con `date-fns` (`startOfMonth`, `eachDayOfInterval`, etc.); navegación mes anterior/siguiente, "Hoy".
- Sin librerías nuevas: la vista mensual es un grid Tailwind 7-col responsive.
- Colores por tipo usando tokens semánticos del design system (sin colores hardcoded).
- Validación de formularios con `zod` + `react-hook-form` (ya usados en el proyecto).
- Sin integración real con APIs de Meta en esta fase: el calendario es planificación interna; marcar como "publicado" es manual.

## Fuera de alcance (posibles siguientes pasos)

- Publicación automática vía Meta Graph API.
- Comentarios/menciones en cada publicación.
- Aprobaciones multi-paso, notificaciones por email.
- Vista semanal / kanban por estado (fácil de añadir luego sobre el mismo modelo).
