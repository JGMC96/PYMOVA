# Auditoría técnica de PYMOVA · Fase 1

- **Fecha:** 19/10/2026.
- **Commit auditado:** `9925544` (main).
- **Alcance:** solo lectura. Ni el código ni la base de datos se han cambiado.
- **Límites:** se ha leído el SQL de `supabase/migrations/` y `drizzle/migrations/`, no la base de datos en producción. Si hay cambios hechos a mano desde el panel de Supabase, aquí no aparecen. Los hallazgos de RLS marcados como «a confirmar» se reproducen en un entorno de pruebas antes de corregirlos (Fase 2).

## Resumen

1. **Hay un fallo crítico de aislamiento entre negocios.** Cualquier usuario registrado puede darse de alta como propietario de un negocio ajeno si conoce su UUID (C1).
2. **Varias tablas sensibles aceptan escrituras directas que se saltan las RPC.** Pasa en líneas de ticket, devoluciones, fichajes, caja y suscripción, así que la lógica de negocio solo se cumple si el cliente coopera (A1-A5).
3. **El esquema está repartido en dos carpetas de migraciones, y Drizzle no se usa como ORM** (A6).
4. **Recuento:** 1 crítico, 14 altos (A1-A14), 8 medios de backend y 9 de frontend (F1-F9), y 11 bajos (B1-B6 y F10-F14).
5. **Las comprobaciones de tipos, los tests y el build pasan, pero el lint falla.** Además, la lógica crítica de caja, stock, fichajes, cobros y numeración no tiene ningún test.

## Resultado de las comprobaciones

| Comando | Resultado |
|---|---|
| `npm i` | Correcto: 743 paquetes. `npm audit`: 43 vulnerabilidades (2 críticas, 31 altas). En producción (`--omit=dev`): 19, ninguna crítica y 17 altas (react-router / @remix-run/router, lodash, nanoid, postcss, ws…). Las 2 críticas son de `vitest`/`tinypool`, que solo se usan en desarrollo. |
| `npm run lint` | **Falla: 87 problemas (73 errores y 14 avisos) en 25 archivos.** 64 errores son `no-explicit-any`, concentrados en los hooks de RRHH (`useHrEmployees.ts` 11; `useAbsences.ts`, `usePermissions.ts` y `useSchedules.ts` 8 cada uno; `useTimeClock.ts` 5). Los demás: 2 `no-empty-object-type`, 1 `no-unused-expressions`, 1 `no-require-imports` (`tailwind.config.ts:111`), 13 avisos `react-refresh/only-export-components` y 1 aviso `exhaustive-deps`. |
| `npx tsc --noEmit -p tsconfig.app.json` | Correcto, sin errores. Pero con `strict: false`, `noImplicitAny: false` y `strictNullChecks: false`, así que comprueba poco. |
| `npm test` | Correcto: 3 archivos y 24 tests (`shopify-core` 21, `ticket` 2 y un ejemplo). |
| `npm run build` | Correcto en 11 s. Avisos: un único bundle JS de **1.297 kB** (370 kB comprimido), sin división de código; `@import` de Google Fonts después de otras reglas en `src/index.css` (línea 9); datos de Browserslist con 16 meses. |

## Hallazgos

Cada hallazgo indica dónde está, qué impacto tiene y cómo corregirlo. Las rutas `supabase/migrations/2026…_*.sql` se abrevian con el prefijo de fecha, por ejemplo `sm/20260126154111:381`. Las de `drizzle/migrations/` se abrevian como `dz/0006:22`.

### Crítico

**C1 · Cualquier usuario puede hacerse propietario de un negocio ajeno.** `dz/0006:22-36`, política «Owner/Admin can insert members» de `business_members`.

- **Qué pasa:** la rama «alta inicial» permite insertar si `auth.uid() = user_id` y no existe ningún miembro del negocio. Pero ese `NOT EXISTS` se evalúa con la RLS del propio usuario, y un usuario que no pertenece al negocio no ve a ninguno de sus miembros. Para él, la subconsulta siempre está vacía. Por eso puede ejecutar `insert into business_members (business_id, user_id, role) values ('<uuid ajeno>', auth.uid(), 'owner')` desde la API REST. La versión anterior (`sm/20260126183510:6`) tenía el mismo efecto.
- **Impacto:** toma completa de cualquier negocio: facturas, clientes, empleados, conexión con Shopify. Basta con conocer el UUID del negocio, que aparece en las rutas de Storage de `business-logos` (`dz/0012`), en los enlaces y en las respuestas de la API.
- **Corrección:** quitar la rama de alta inicial de la política y crear el negocio con una RPC `create_business(...)` `SECURITY DEFINER`. La RPC inserta el negocio y el miembro owner en la misma transacción. La comprobación de «sin miembros» se hace dentro de la función, que no está sujeta a RLS. Añadir un test SQL o de integración que intente el ataque.
- **Estado (19/10/2026):**
  - **Confirmado** en un Postgres 17 local con las 51 migraciones: una cuenta sin negocios se hace owner del negocio de la víctima, ve sus clientes y puede expulsarla.
  - En producción («Business OS»), las políticas leídas con una consulta de solo lectura son idénticas a las del repo.
  - Sin indicios de explotación: las 4 membresías tienen origen legítimo.
  - Corrección en [JGMC96/PYMOVA#2](https://github.com/JGMC96/PYMOVA/pull/2), pendiente de aplicar.

**C1b · El onboarding no puede funcionar con este esquema.** `src/pages/Onboarding.tsx:70-151`. Se descubrió al reproducir C1.

- **Qué pasa:** hay dos fallos.
  - El `insert().select()` en `businesses` choca con la RLS de SELECT, que exige ser miembro, y el usuario todavía no lo es. Es así desde `sm/20260609091726`.
  - El insert de `business_modules` duplica los módulos que ya crea el trigger `sync_modules_on_subscription_change` (`sm/20260729163758`).
- **Impacto:** en producción el último negocio se creó el 27/04, lo que cuadra con que los clientes nuevos no pueden darse de alta.
- **Corrección:** la misma RPC `create_business`, en [JGMC96/PYMOVA#2](https://github.com/JGMC96/PYMOVA/pull/2).

### Alto

**A1 · Las ventas no validan que productos y variantes sean del negocio: stock entre negocios.** `dz/0004:7-63` (`create_sale_with_items`) y el trigger `decrement_stock_on_sale` (`sm/20260730103608:5-45`).

- **Qué pasa:** la RPC solo usa `business_id` en un `LEFT JOIN` para leer el coste (`dz/0004:60`). Las líneas se insertan con el `variant_id` o el `product_id` que mande el cliente. Después, el trigger (`SECURITY DEFINER`, que se salta la RLS) descuenta stock de esa variante sea del negocio que sea. Lo mismo pasa con `_client_id` y `_register_session_id`, que tampoco se validan.
- **Impacto:** un miembro de un negocio puede alterar el stock de otro negocio si conoce los UUID de sus variantes. También puede asociar ventas a cajas de otro negocio.
- **Corrección:** en la RPC, rechazar la venta si alguna línea no pertenece a `_business_id`. En el trigger, filtrar con `AND business_id = (select business_id from sales where id = NEW.sale_id)`. Tests de los dos casos.
- **Estado (19/10/2026):** corregido en `dz/0017`. La RPC valida cliente, caja, productos y variantes del negocio; el trigger comprueba el negocio de la venta. Tests en `src/test/rls/tpv-ventas.test.ts`.

**A2 · Los tickets se pueden editar después de la venta.** `sm/20260609091726:27`, política «Members can manage sale items» (`FOR ALL`).

- **Qué pasa:** cualquier miembro, staff incluido, puede hacer UPDATE y DELETE en `sale_items` de ventas ya cerradas, e INSERT de líneas nuevas que disparan el descuento de stock y la cola de Shopify. `sales` no tiene política de UPDATE, pero sus líneas sí se pueden cambiar.
- **Impacto:** se puede manipular un ticket a posteriori (importe, cantidades), con descuadres de caja y de stock. Choca con la inalterabilidad de los registros de facturación (Veri*factu).
- **Corrección:** dejar solo `SELECT` para miembros. Las líneas solo se crean dentro de `create_sale_with_items`. Las correcciones se hacen con devoluciones.
- **Estado (19/10/2026):** corregido en `dz/0017`. `sales` y `sale_items` sin escritura directa; solo el super admin borra ventas, y queda en Actividad (decisión del usuario).

**A3 · Las devoluciones se pueden crear sin la RPC, con importe libre, y se reembolsan en Shopify.** `sm/20260730103608:154` («Members create returns») y `:169` (líneas), junto con `supabase/functions/shopify-pos-refund/index.ts:110-117`.

- **Qué pasa:** cualquier miembro puede insertar en `sale_returns` un `total` arbitrario sin pasar por `create_sale_return`, que es la que limita las cantidades. `shopify-pos-refund` envía después ese `total` como transacción REFUND al pedido de Shopify.
- **Impacto:** reembolsos mayores de lo vendido, o sin líneas, que se ejecutan en Shopify. También descuadran el arqueo.
- **Corrección:** quitar el INSERT directo en `sale_returns` y `sale_return_items`, de modo que solo se pueda devolver con la RPC. En `shopify-pos-refund`, recalcular el importe a partir de las líneas y limitarlo al total de la venta.
- **Estado (19/10/2026):** corregido en `dz/0017` y en `shopify-pos-refund` (`refundAmountForReturn`): el importe sale de las líneas, se topa a lo pendiente de la venta y una devolución que no cuadra se marca `failed` sin reembolsar.

**A4 · Los fichajes se pueden falsear.** `sm/20260609090816:100` («Users can insert their own time entries») y `clock_action` en `:304-405`.

- **Qué pasa:** el empleado puede insertar directamente en `hr_time_entries` con un `occurred_at` libre, sin pasar por `clock_action`, que es la que fija `now()` y valida la secuencia. Además, `clock_action` calcula el día con `now()::date` en UTC (`:321`). Un turno que pasa de medianoche en España no se puede cerrar («No hay sesión abierta para cerrar»), y si alguien ficha entre las 00:00 y las 02:00 (hora de Madrid), el fichaje se apunta en el día anterior.
- **Impacto:** el registro de jornada (art. 34.9 ET) pierde fiabilidad. Las horas trabajadas y los informes mensuales salen mal en los turnos de noche.
- **Corrección:** quitar la política de INSERT del usuario, de modo que solo se pueda fichar con la RPC. Calcular el día en la zona horaria del negocio (`now() at time zone business_tz`) y buscar la sesión abierta sin depender de la fecha. Tests de transiciones y de cambio de día.
- **Estado (20/10/2026):** corregido en `dz/0020`. Nadie escribe directamente en `hr_time_entries` ni en `hr_work_sessions`: se ficha con `clock_action` y los admins corrigen con `correct_work_session`, que exige motivo y lo deja en `audit_logs`. El día sale de `business_local_date` (zona horaria del negocio) y la sesión abierta se busca sin mirar la fecha. Además, cada entrada abre una sesión nueva: con la jornada partida de la tienda (11-14 y 17-20), la pausa del mediodía ya no cuenta como trabajada. Una sesión abierta más de 12 h queda pendiente de revisión y sin horas.

**A5 · El propietario puede cambiarse de plan y activar módulos sin pagar.** `sm/20260126154111:381` (`subscriptions`, «Owner can manage subscription», `FOR ALL` sin `WITH CHECK`) y `sm/20260126161816:133` (`business_modules`, «Owner can manage modules»).

- **Qué pasa:** el owner puede hacer `update subscriptions set plan_id = <plan superior>`. El trigger `sync_business_modules_from_plan` (`sm/20260729163758`) le activa entonces los módulos de ese plan. También puede activar módulos directamente en `business_modules`.
- **Impacto:** se salta el cobro del plan.
- **Corrección:** `subscriptions` y `business_modules` deben ser de solo lectura para los miembros. Los cambios de plan pasan por una RPC o edge function que valide el pago, o solo por el super admin.
- **Estado (19/10/2026):**
  - `dz/0014`: los miembros ya no escriben en `subscriptions` ni en `business_modules`.
  - `dz/0016`: el super admin tampoco edita `subscriptions` directamente. Usa `admin_update_subscription`, que valida y exige un motivo. Las tablas `subscriptions`, `business_modules` y `platform_roles` quedan auditadas, y `audit_logs` guarda `actor_is_super_admin` y `reason`. La pantalla `/admin/activity` muestra la actividad de super admin con `get_platform_audit_log`.
  - Pendiente: validar el pago antes del cambio de plan (cuando haya pasarela), y una RPC para los roles de plataforma que impida retirar al último super admin.

**A6 · Hay dos fuentes de migraciones y `drizzle/schema.ts` está vacío.** `drizzle/schema.ts:1`, `drizzle.config.ts`, `drizzle/migrations/0000-0013` y `supabase/migrations/`.

- **Qué pasa:** desde septiembre, Lovable escribe el SQL en `drizzle/migrations/`, que crea `shopify_inventory_pushes`, cambia políticas y reemplaza RPC. `supabase/migrations/` se quedó en el 31/07. `schema.ts` está vacío («intentionally left blank»): Drizzle no aporta tipos ni consultas, solo aplica SQL. Con un `supabase db reset` o un proyecto nuevo creado desde `supabase/migrations/` faltarían 14 migraciones, y entre ellas los arreglos de seguridad de la `0006`. Además, la `0013` usa `ADD CONSTRAINT` sin `IF NOT EXISTS`, así que no es idempotente.
- **Impacto:** no se puede reproducir el esquema, cuesta revisar la RLS y hay riesgo de que el entorno de staging y el de producción no tengan el mismo esquema.
- **Corrección:** decidir un único canal. Propuesta: seguir con `drizzle/migrations/`, porque es el que usa Lovable, y documentarlo. O al revés: pedir a Lovable que vuelva a `supabase/migrations/`. En los dos casos, añadir un control en CI que compare el esquema real (`supabase db dump --schema public`) con el resultado de aplicar las migraciones.

**A7 · La numeración de tickets y devoluciones no es correlativa con concurrencia.** `generate_sale_number` (`sm/20260126191658:101-125`) y `create_sale_return` (`dz/0004:67`, `MAX(...)+1`).

- **Qué pasa:** dos ventas simultáneas leen el mismo `MAX` y reciben el mismo `VTA-…`. No hay índice único en `sales (business_id, sale_number)` ni en `invoices (business_id, invoice_number)`. Las facturas sí usan un contador con `FOR UPDATE` (`sm/20260126161816:203`), pero el admin puede reescribir `business_settings.next_invoice_number` porque tiene permiso de gestión de ajustes (`sm/20260126161816:192`).
- **Impacto:** tickets con el mismo número y saltos o duplicados en la numeración de facturas. Es un incumplimiento fiscal (Veri*factu exige numeración correlativa sin huecos).
- **Corrección:** contadores por negocio en una tabla con `FOR UPDATE` (o `INSERT … ON CONFLICT DO UPDATE … RETURNING`), índices únicos y quitar `next_invoice_number` de lo que puede escribir el cliente.
- **Estado (19/10/2026):** corregido en `dz/0018`. Contadores `next_sale_number`, `next_return_number`, `next_online_order_number` y `next_invoice_number` en `business_settings`, sembrados con la serie existente y consumidos por `next_document_number` con bloqueo de fila; trigger que impide editarlos desde el cliente; números de documento inmutables; índices únicos en ventas, facturas y devoluciones; las facturas solo nacen con `create_invoice_with_items`. Pendiente: huecos justificados por anulación (hoy el borrado del super admin deja hueco).

**A8 · Un admin puede invitar a alguien como owner.** `sm/20260729173452:32` (INSERT en `business_invitations`) y `accept_business_invitation` (`sm/20260729184300:1`).

- **Qué pasa:** la política no limita el `role` de la invitación, y la RPC inserta o actualiza el miembro con `_inv.role`. Un admin puede invitar a otra cuenta suya como `owner`, saltándose la regla de la `dz/0006`, según la cual solo un owner da el rol owner.
- **Impacto:** escalada de privilegios de admin a owner.
- **Corrección:** en la política de INSERT y UPDATE, exigir `role <> 'owner' OR has_business_role(business_id, 'owner')`. Repetir la comprobación en la RPC.
- **Estado (19/10/2026):** corregido en `dz/0018`. Política de INSERT, trigger en UPDATE (un admin puede revocar, pero no subir a owner) y comprobación en `accept_business_invitation` del rol de quien invitó. Tests en `src/test/rls/numeracion-e-invitaciones.test.ts`.

**A9 · La integración con Shopify admite una sola tienda por despliegue: el primero que la reclama se la queda.** `supabase/functions/_shared/shopify-client.ts:34-41` (`SHOPIFY_STORE_DOMAIN`), `shopify-sync/index.ts:130` y `claim_shopify_shop` (`sm/20260731184426:38`).

- **Qué pasa:** el dominio y las credenciales de la tienda son globales. Cualquier admin de cualquier negocio puede ejecutar «claim» mientras la tienda no esté vinculada, y a partir de ahí lee pedidos y clientes de esa tienda.
- **Impacto:** no escala a varios clientes con Shopify. Al empezar, cualquier negocio de prueba puede quedarse con la tienda.
- **Corrección a corto plazo:** limitar «claim» al super admin o a una lista de negocios autorizados.
- **Corrección a medio plazo:** OAuth por tienda (`shop` + token por `shopify_connections`) y webhooks enrutados por `x-shopify-shop-domain`.

**A10 · Las ventas del TPV se pueden duplicar en Shopify.** `supabase/functions/shopify-pos-order/index.ts:82-160`.

- **Qué pasa:** la función lee las ventas con `shopify_order_gid IS NULL` y crea el pedido sin bloquear ni marcar antes la fila, y `orderCreate` no lleva clave de idempotencia. Dos llamadas a la vez (dos pestañas, o el envío automático tras cada venta mientras sigue el anterior) crean el mismo pedido dos veces. `shopify-pos-refund` sí manda `key: ret.id`.
- **Impacto:** pedidos y ventas duplicados en Shopify, que descuadran la contabilidad y el stock de Shopify.
- **Corrección:** reservar cada venta antes de llamar a Shopify (`update … set shopify_order_status = 'sending' where id = … and shopify_order_status is distinct from 'sending' returning id`), o un `pg_advisory_xact_lock` por negocio. Antes de crear, buscar en Shopify por `sourceIdentifier`.

**A14 · No se podía borrar ningún negocio.** `audit_security_changes()` (`dz/0007`) y `audit_log_changes()` (`sm/20260126161816:281`). Se encontró el 19/10/2026 al intentar borrar el TUILUS duplicado.

- **Qué pasa:** al borrar un negocio, los triggers de auditoría insertaban en `audit_logs` filas con el `business_id` del negocio que se estaba borrando, tanto la del propio negocio como las de cada fila borrada en cascada. La FK `audit_logs_business_id_fkey` las rechazaba. Su `ON DELETE SET NULL` solo afecta a las filas que ya existían.
- **Impacto:** ni el owner, ni el super admin desde `/admin/businesses`, ni el SQL directo podían borrar un negocio. El error que aparecía era `insert or update on table "audit_logs" violates foreign key constraint`.
- **Corrección:** `dz/0015`. Si el negocio ya no existe, la fila de auditoría se guarda con `business_id` NULL. El id sigue en `old_data` y en `record_id`. Tests en `src/test/rls/borrado-negocio.test.ts`.

### Medio

**M1 · La venta confía en los importes que manda el cliente.** `dz/0004:7-63`. El cálculo se hace en `POSPanel.tsx:192-203`.

- **Qué pasa:** `subtotal`, `tax`, `total`, `unit_price` y el `total` de cada línea vienen del navegador, y no se comprueba que la suma de las líneas coincida con el total.
- **Impacto:** un error del frontend o una llamada manipulada guarda tickets incoherentes, y el arqueo los da por buenos.
- **Corrección:** recalcular los totales en la RPC (con el precio de catálogo o validando el descuento) y rechazar descuadres de más de 0,01 €.
- **Estado (19/10/2026):** corregido en `dz/0017`. Precio del catálogo, descuento por línea deducido del neto, IVA al tipo del negocio y tolerancia de 0,02 €. Decisión del usuario: el precio manual no existe; si se quiere, irá con permiso de admin y auditoría.

**M2 · El arqueo de caja ignora las devoluciones en efectivo y permite dos cajas abiertas.** `close_register_session` (`sm/20260729155359:161`) y `open_register_session` (`:134`).

- **Qué pasa:** el efectivo esperado solo suma ventas en efectivo y no resta las devoluciones con `refund_method = 'cash'`. Con dos aperturas simultáneas, las dos pasan el `IF EXISTS`. Además, cualquier miembro puede insertar directamente en `cash_register_sessions`, con una caja ya cerrada y cifras inventadas (`:78`).
- **Corrección:** restar las devoluciones en efectivo, crear un índice único parcial `(business_id) WHERE status = 'open'` y quitar el INSERT directo.
- **Estado (20/10/2026):** corregido en `dz/0021`. La caja solo se abre y se cierra por RPC (sin INSERT ni UPDATE directo; aperturas y cierres auditados). Las devoluciones guardan su caja y el arqueo resta las de efectivo. El índice único ya existía; ahora la segunda apertura recibe «Ya hay una caja abierta». Además, por decisión del usuario: cualquier miembro puede cerrar la caja y cobrar o devolver en efectivo exige caja abierta. Las devoluciones valen lo cobrado en la línea, con su descuento, también en el reembolso de Shopify.

**M3 · Cualquier miembro puede editar facturas, cobros, productos y variantes.** `sm/20260126161816:243-264` y `sm/20260729155359:38-40`.

- **Qué pasa:** el staff puede hacer UPDATE en `invoices` (también en las ya pagadas), `payments`, `products` (precio) y `product_variants` (stock), sin pasar por las RPC. `create_payment_and_recalc_invoice` es correcta, pero se puede saltar.
- **Corrección:** según el rol, solo admin para precios y stock, y bloquear con un trigger la edición de facturas emitidas o pagadas. Hay que decidir con el usuario qué puede hacer el staff.

**M4 · Algunas RPC posteriores al 09/06 no revocan el permiso a `anon` y no todas validan permisos.**

- **Qué pasa:** `generate_online_order_number` (`sm/20260730170011:130`) es `SECURITY DEFINER` sin ninguna comprobación, y tiene `GRANT … TO authenticated` sin `REVOKE … FROM PUBLIC`. Cualquiera puede consumir números de pedido de otro negocio. `create_online_order`, `set_online_order_status` y `create_online_order_return` tampoco revocan el permiso a `PUBLIC`, aunque dentro sí comprueban `auth.uid()`.
- **Corrección:** comprobar la pertenencia al negocio en `generate_online_order_number`, y hacer `REVOKE … FROM PUBLIC, anon` en todas.
- **Estado (19/10/2026):** `generate_online_order_number` corregida en `dz/0018` (pertenencia al negocio y REVOKE). Las otras tres siguen pendientes.

**M5 · La importación de pedidos de Shopify está repetida en tres sitios.** `_shared/shopify-webhooks.ts:62-85`, `shopify-orders/index.ts:190-212` y `shopify-sync/index.ts:548-570`.

- **Qué pasa:** el mismo filtro `-tag:pymova-tpv`, la llamada a `upsert_external_order` y el `stock_applied: true` están copiados en los tres sitios.
- **Impacto:** cualquier arreglo hay que hacerlo tres veces. Además, `stock_applied` se marca sin descontar stock en local, y no está documentado si es a propósito.
- **Corrección:** una única función `importShopifyOrder()` en `_shared`, con tests.

**M6 · Varios errores de Supabase se ignoran en las edge functions.**

- **Qué pasa:** en `shopify-pos-order` y en `shopify-pos-refund`, los `update` de estado no comprueban `error`. En `shopify-orders-webhook/index.ts:41-73`, la búsqueda de la conexión y la inserción en la cola tampoco lo comprueban: si la inserción falla, se responde 200 y el evento se pierde.
- **Corrección:** comprobar `error` y responder 500 cuando no se ha podido encolar, para que Shopify reintente.

**M7 · Lint roto y TypeScript poco estricto.** Ver la tabla de comprobaciones.

- **Impacto:** el CI no puede depender del lint, y los `any` de los hooks de RRHH ocultan errores de nulos.
- **Corrección:** arreglar los 73 errores de lint por módulos y activar `strictNullChecks` de forma gradual (con `// @ts-expect-error` controlado). No hay CI en el repo: crear uno.

**M8 · Dependencias con vulnerabilidades altas en producción.** react-router 6.30.1 (`@remix-run/router`), lodash, nanoid, postcss y ws.

- **Corrección:** `npm audit fix` en una PR propia, comprobando el build y los tests. No usar `--force`.

### Bajo

- **B1 · `.env` versionado y fuera del `.gitignore`.** Ahora solo tiene claves públicas `VITE_*`, y la clave es la anon (comprobado sin mostrar su valor). El riesgo es que alguien añada un secreto en el futuro. Corrección: añadir `.env.local` al `.gitignore` y una comprobación de secretos (gitleaks) en el CI.
- **B2 · Un único bundle de 1,3 MB.** Corrección: `React.lazy` por módulo del dashboard y `/admin`.
- **B3 · Avisos del build.** `@import` de fuentes fuera de lugar en `src/index.css:9` y Browserslist desactualizado.
- **B4 · `has_platform_role(_user_id, …)` deja comprobar el rol de cualquier usuario.** Cualquier usuario autenticado puede saber si otro es super admin. Corrección: usar solo `is_super_admin()` sin parámetro.
- **B5 · `README.md` es la plantilla de Lovable,** con `REPLACE_WITH_PROJECT_ID`.
- **B6 · CORS `*` en las edge functions.** Es aceptable porque exigen JWT, pero conviene limitarlo al dominio de la app.

## Avisos del escáner de Lovable (19/10/2026)

Tres avisos recibidos del escáner de la plataforma y comprobados en el código:

- **E1 · Inyección de fórmulas en el CSV de permisos (CWE-1236).** `src/components/hr/MonthlyPermissionsSummary.tsx:84`. El nombre del empleado se concatenaba sin neutralizar `=`, `+`, `-`, `@`, tabulador ni retorno de carro. **Corregido:** `csvCell` en `src/lib/csv.ts` (prefijo `'` y comillas escapadas), con tests.
- **E2 · Correos y un token en los logs de las edge functions.** `handle-email-unsubscribe/index.ts:106` (token de baja en claro) y `send-transactional-email/index.ts` (correo completo en 7 logs). **Corregido:** `redactEmail` y `redactToken` en `_shared/privacy.ts`, con tests.
- **E3 · Módulos comprobados solo en el cliente.** La RLS de `products` y del resto de tablas de módulos no mira si el negocio tiene el módulo activo; solo lo hace `RequireModule` en la interfaz. **Pendiente:** afecta a todas las tablas de módulos de pago y se decide con el usuario (cambio de RLS en todas ellas, o aceptar que un miembro pueda leer por API datos de un módulo no contratado).

## Revisión de seguridad (20/10/2026)

Revisión de los cambios de las PR #2 a #10, con una lectura independiente y cada hallazgo reproducido en el Postgres local:

- **R1 · Un admin podía hacerse propietario (alta).** El trigger `protect_invitation_role` (`dz/0018`) solo vigilaba que el rol *pasara a* owner. Un admin podía crear una invitación owner en un negocio propio, moverla al negocio de la víctima con `invited_by` = su propietario y aceptarla con otra cuenta, o reactivar una invitación owner ya aceptada o revocada. **Corregido en `dz/0023`:** desde el cliente, una invitación solo se puede revocar.
- **R2 · Devolver dos veces la misma línea (media).** `create_sale_return` (`dz/0021`) aceptaba la misma línea dos veces en una devolución: una venta de 100 € se devolvía por 200 €, reponía dos unidades y el arqueo cuadraba con 100 € de menos. Lo podía hacer cualquier miembro. **Corregido en `dz/0023`:** error si una línea se repite, el cálculo de lo ya devuelto incluye la propia devolución e índice único `(return_id, sale_item_id)`.
- **R3 · Contadores esquivables borrando los ajustes (baja).** La política `FOR ALL` de `business_settings` dejaba a un admin borrar la fila y volver a crearla con otros contadores. **Corregido en `dz/0023`:** el cliente solo lee y actualiza los ajustes.
- En producción no había ningún dato afectado (comprobado el 20/10: sin líneas repetidas, sin devoluciones mayores que su venta y sin invitaciones owner de quien no era owner).
- **Escáner de Lovable (20/10):** Lovable aplicó por su cuenta la `dz/0022` (un empleado no puede crear ni pasar a aprobada su propia ausencia o permiso). Revisada, correcta y con test desde la `dz/0023`. Los avisos de marketing y productos (E3) quedan abiertos a propósito.

## Seguridad multi-tenant: lo que está bien

- **Las 47 tablas** de `supabase/migrations/` y `shopify_inventory_pushes` tienen la RLS activa, y todas tienen políticas por `business_id` o rol (inventario completo hecho con las migraciones). `user_roles` se borró (`sm/20260126161816:7`).
- Las funciones de rol (`is_member_of_business`, `has_min_role`…) son `SECURITY DEFINER` con `search_path` fijado y comprueban `is_active`.
- **Tokens de Shopify:** `shopify_app_tokens` niega todo acceso a `authenticated` y `anon` (`sm/20260731182451:11-16`). El token solo vive en las edge functions.
- **Webhooks de Shopify:** HMAC-SHA256 sobre el cuerpo en bruto, con comparación en tiempo constante (`_shared/shopify-core.ts:40-71`), deduplicación con índice único (`sm/20260730170647:60`) y respuesta inmediata con la cola.
- **Edge functions con usuario:** `shopify-sync`, `shopify-orders`, `shopify-pos-*` e `shopify-inventory-push` verifican el JWT con `auth.getUser()` y la pertenencia o el rol con el cliente del usuario antes de usar el service role. `config.toml` deja `verify_jwt = false` solo en el webhook de Shopify (HMAC) y en las funciones de email de Lovable, que verifican su propia firma o token.
- **Secretos:** no hay ninguno en el repositorio ni en su historial (búsqueda de JWT de service role, `shpat_`/`shpss_`, `sk_`, claves privadas, URLs de Postgres con contraseña). El único `shpss_…` es un valor ficticio de un test (`src/test/shopify-core.test.ts:68`).
- Las RPC de cobro (`create_payment_and_recalc_invoice`), devolución (`create_sale_return`) y caja bloquean las filas con `FOR UPDATE` y validan cantidades e importes.
- La `dz/0006` ya corrigió la escalada de admin a owner en `business_members` (UPDATE) y limitó la creación de negocios a 10 por usuario.

## Huecos de tests en la lógica crítica

| Área | Tests hoy | Qué falta |
|---|---|---|
| Caja (apertura, cierre, arqueo) | Ninguno | Arqueo con ventas, propinas y devoluciones en efectivo; doble apertura; cierre por staff (debe fallar). |
| Ventas y stock | Ninguno | Stock insuficiente, variante de otro negocio, coste congelado, cola de Shopify. |
| Tickets | `ticket.test.ts` (2) | Formato con descuentos, propinas, IVA mixto y devoluciones. |
| Devoluciones | Ninguno | Más unidades que las vendidas, reposición de stock, importe calculado. |
| Cobros y facturas | Ninguno | Pago parcial o total, estado `overdue`, numeración concurrente. |
| Fichajes y vacaciones | Ninguno | Transiciones de `clock_action`, cambio de día en Madrid, pausas abiertas al salir, días de ausencia y solapes. |
| Shopify | `shopify-core.test.ts` (21: token, HMAC, paginación, inventario) | Importación de pedidos, mapeo de variantes (`src/lib/variantMapping.ts`), idempotencia de los pedidos del TPV. |
| RLS | Ninguno | Batería de pruebas de aislamiento con dos negocios y tres roles (pgTAP o tests de integración contra un proyecto de staging). |

## Frontend

Hallazgos de la revisión del frontend. Las líneas se han comprobado en el código.

### Alto

**A11 · El IVA del TPV y el del ticket no cuadran, y el IVA por defecto es el 16 % (de México).**

- **Qué pasa:** el TPV suma el IVA encima de la base (`src/components/retail/POSPanel.tsx:199-201`), pero el ticket trata el total como IVA incluido y vuelve a desglosarlo (`src/lib/ticket.ts:89-101`). El tipo por defecto es el 16 % en `src/hooks/useBusinessSettings.ts:104` y en `src/pages/Onboarding.tsx:145`.
- **Impacto:** la base imponible y la cuota impresas no coinciden con lo cobrado, y un negocio recién creado factura con un IVA que no existe en España.
- **Corrección:** decidir un modelo (en España, precios con IVA incluido) y aplicarlo en el TPV, en la RPC y en el ticket. IVA por defecto del 21 %. Añadir tests de `taxBreakdown` con la venta completa.
- **Estado (19/10/2026):** corregido en `dz/0019` y en el frontend. Precio del catálogo con IVA incluido en TPV y facturas (decisión del usuario); `sales.total` e `invoices.total` son lo que paga el cliente y la base y la cuota se deducen (`src/lib/tax.ts`, `taxBreakdown`); tipo por defecto 21 % en la base de datos y en el cliente. Detectado en la prueba real del 19/10: un calcetín de 6 € se cobró a 7,26 € (`VTA-000002`, ya devuelta; queda con el modelo antiguo, no se reescribe el histórico).

**A12 · El stock se ajusta con valores absolutos desde el cliente.**

- **Qué pasa:** `updateStock` hace `update products set stock_quantity = N` (`src/hooks/useInventory.ts:72-77`), y la importación de Shopify sobrescribe el stock (`src/hooks/useShopifyImport.ts:165` y `:237`). Las dos cosas compiten con el trigger que descuenta las ventas.
- **Impacto:** se pierden ventas hechas mientras alguien ajusta el stock, y no queda historial de movimientos.
- **Corrección:** RPC `adjust_stock(_variant_id, _delta, _reason)` con una tabla `stock_movements`, que además alimenta la cola de Shopify.
- **Estado (20/10/2026): corregido.** Primera parte en `dz/0024`:
  - historial `stock_movements` con el origen de cada cambio (venta, devolución, pedido online, Shopify, importación, alta);
  - el stock del producto padre es la suma de sus variantes;
  - para los artículos emparejados, el stock local sale de Shopify en la ubicación de la tienda (Tienda Valencia, decisión del usuario), más los envíos pendientes. Los webhooks `inventory_levels/update`, que antes no hacían nada, ahora lo actualizan al momento;
  - acción `refresh-stock` y botón «Actualizar stock desde Shopify»;
  - la importación ya no pisa el stock con la suma de ubicaciones.
  - **Segunda parte en `dz/0025`:** `adjust_stock` solo para admins y con motivo; queda como movimiento `manual` y el delta va a Shopify. El cliente ya no puede cambiar `stock_quantity` escribiendo en las tablas, y el stock inicial al crear un artículo solo lo pone un admin. **A12 corregido.**
- **Encontrado de paso y corregido en `dz/0024`:**
  - `create_online_order_return` fallaba siempre con «return_number is ambiguous»: en producción no se había podido registrar ninguna devolución online;
  - cancelar o devolver en Pymova un pedido de Shopify sumaba stock local que nunca se había restado;
  - los pedidos online creados en Pymova no llegaban a la cola de Shopify.

**A13 · El onboarding no es transaccional.**

- **Qué pasa:** crea negocio, miembro, suscripción, módulos y ajustes con 6 inserts sueltos desde el navegador (`src/pages/Onboarding.tsx:70-146`). Si alguno falla, el negocio queda a medias. Además, si falla la consulta de membresías, `AuthRedirector.tsx:32-39` manda a `/onboarding` y se pueden crear negocios duplicados.
- **Corrección:** la misma RPC `create_business` de C1, que también cierra A5.

### Medio

- **F1 · TanStack Query está montado, pero ningún hook lo usa** (0 `useQuery`/`useMutation`). Todos usan `useState` y recargas manuales, con el patrón `requestIdRef` repetido en unos 18 hooks. No hay caché compartida: `useStoreProfile` se instancia 3 veces en Retail y `useCashRegister` 2 veces, sin compartir estado. Corrección: migrar hook a hook a `useQuery` con claves `[tabla, businessId]` e invalidación tras cada mutación, empezando por Retail.
- **F2 · Consultas N+1 en la importación de Shopify desde el navegador.** `useShopifyImport.ts:172-257`: de 2 a 4 consultas por producto y 1 por variante. Con catálogos grandes es lenta y, si se cierra la pestaña, queda a medias. El respaldo por nombre con `maybeSingle` (`:183-188`) falla con nombres repetidos y acaba duplicando productos. Corrección: hacer la importación en la edge function `shopify-sync` (ya tiene acción `sync`) con upserts por lotes.
- **F3 · Pendiente de cobro calculado en el cliente.** `usePayments.ts:207-210` descarga todos los pagos del negocio y PostgREST corta en 1.000 filas, así que el pendiente sale mal en negocios con historial. Corrección: una RPC agregada.
- **F4 · El importe de la devolución online es libre.** Se escribe a mano (`OnlineOrderReturnDialog.tsx:58`), y `create_online_order_return` lo guarda tal cual (`sm/20260730170011:230-250`) antes del reembolso en Shopify (`useOnlineOrders.ts:252-257`). Corrección: limitarlo al total del pedido menos lo ya devuelto.
- **F5 · Cambio de estado de factura desde el cliente.** `useInvoices.ts:242-253` cambia `status` y `paid_at` sin validar las transiciones. Corrección: una RPC con una máquina de estados (ver también M3).
- **F6 · Errores que se tragan en silencio.**
  - `src/lib/shopifyStockPush.ts:8-17`: `functions.invoke` no lanza excepciones, sino que devuelve `{ error }`, así que el `catch` nunca salta.
  - `BusinessContext.tsx:147-151` y `Onboarding.tsx:151` ignoran el error de `set_active_business`.
  - `useVariantAudit.ts:57-106` ignora los errores y hace un delete y un insert no atómicos.
  - `useHrEmployees.ts:94` muestra el aviso de éxito aunque falle.
  - Otros errores ignorados: `useCashRegister.ts:59`, `useTimeClock.ts:67`, `useAbsences.ts:59` y `usePermissions.ts:58`.
- **F7 · Fechas en UTC en los horarios.** `useSchedules.ts:29-30` usa `toISOString().slice(0, 10)` sobre fechas locales. En España desplaza el rango del mes un día.
- **F8 · El control de rol de la interfaz es solo visual.** `RequireRole` no se usa en ninguna parte. Settings, Retail (ajuste de stock, borrado de variantes) e Integraciones se muestran a staff. Shopify lo frena la edge function (exige admin), pero el resto depende de la RLS, que hoy permite al staff demasiado (M3). Corrección: aplicar `RequireRole` o ocultar las acciones según el rol, y a la vez endurecer la RLS.
- **F9 · Se puede cobrar en el TPV sin caja abierta.** Solo sale un aviso (`POSPanel.tsx:235` y `:267`), y esas ventas no entran en ningún arqueo.

### Bajo

- **F10 · Código muerto.** `components/auth/RequireRole.tsx`, `components/NavLink.tsx` y 18 componentes de `components/ui/` sin usar (accordion, carousel, chart, sidebar…). También los exports `generateInvoiceNumber` (`useInvoices.ts:146`) y `updateVariant` (`useProductVariants.ts:97`).
- **F11 · Duplicación.**
  - `sanitizeSearchTerm` está copiado en `useClients.ts:42`, `useInvoices.ts:40`, `usePayments.ts:25` y `useProducts.ts:46`.
  - `useAbsences` y `usePermissions` son casi idénticos.
  - `src/types/database.ts` repite a mano tipos que ya están en `integrations/supabase/types.ts`.
- **F12 · Casts `as any` innecesarios en los hooks de RRHH:** las tablas ya están tipadas. Son la mayor parte de los errores de lint.
- **F13 · `/admin` protegido dentro de `AdminLayout`, no en la ruta.** Funciona, pero cualquier ruta admin nueva que quede fuera del layout estaría desprotegida.
- **F14 · localStorage:** guarda el negocio activo (se valida contra las membresías) y el token de invitación. No guarda roles, y los permisos no dependen de él. Correcto.
