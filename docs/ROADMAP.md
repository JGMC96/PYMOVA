# Roadmap técnico · 3 sprints

Este plan parte de `docs/AUDITORIA.md` (19/10/2026). Cada sprint dura 2 semanas.

**Reglas que se aplican a todos los sprints:**
- **Una PR por tema**, con tests que cubran el arreglo.
- **Modo plan antes de tocar** RLS, migraciones, cobros, caja o la sincronización de stock.
- **Migraciones aditivas e idempotentes**, en la carpeta que se decida en el sprint 1.
- **Nada se aplica a producción sin el visto bueno del usuario.**

## Sprint 0 · Antes de empezar (1-2 días) · HECHO el 19/10

- Proyecto de **staging** en Supabase con el esquema de producción: un `db dump` del esquema, sin datos personales.
- Reproducir en staging el ataque de **C1**, que va primero, y los de A1-A5. Así se confirma que el diagnóstico hecho sobre las migraciones coincide con la base de datos real.
- Decidir el **canal de migraciones** (A6): `drizzle/migrations/` (el que usa Lovable) o `supabase/migrations/`. Apuntarlo en `CLAUDE.md`.

## Sprint 1 · Seguridad multi-tenant e integridad (Críticos y Altos de BD)

Objetivo: que ninguna escritura sensible dependa de la buena fe del cliente.

| PR | Hallazgos | Contenido | Tests |
|---|---|---|---|
| `fix/rls-alta-negocio` | C1, A5, A13 | RPC `create_business` (negocio, owner, suscripción de prueba, módulos y ajustes en una transacción). Quitar la rama de «alta inicial» de la política de `business_members`. `subscriptions` y `business_modules` de solo lectura para miembros. Onboarding usa la RPC. | Usuario sin negocios intenta entrar como owner en un negocio ajeno (debe fallar); owner intenta cambiar el plan (debe fallar); onboarding completo. |
| `fix/rls-invitaciones-owner` | A8 | La invitación con rol owner solo la puede crear un owner. La RPC de aceptar lo comprueba otra vez. | Admin invita como owner (debe fallar). |
| `fix/ventas-aislamiento` | A1, A2, M1 | `create_sale_with_items` valida que productos, variantes, cliente y caja son del negocio, y recalcula totales con tolerancia de 0,01 €. El trigger de stock filtra por negocio. `sale_items` solo lectura. | Venta con una variante ajena; edición de una línea después de la venta; total que no cuadra. |
| `fix/devoluciones-rpc` | A3, F4 | Sin INSERT directo en `sale_returns`/`sale_return_items`. `shopify-pos-refund` calcula el importe a partir de las líneas. Devolución online limitada al total del pedido. | Devolución con total inventado; reembolso que supera lo vendido. |
| `fix/numeracion-correlativa` | A7 | Tabla `document_counters` con bloqueo; índices únicos en `sales` e `invoices`. `next_invoice_number` fuera del alcance del cliente. | 20 ventas simultáneas: todos los números distintos y sin huecos. |
| `fix/fichajes` | A4, F7 | Sin INSERT directo en `hr_time_entries`. `clock_action` con la zona horaria del negocio y la sesión abierta buscada sin depender de la fecha. Fechas locales en `useSchedules`. | Transiciones válidas e inválidas; turno de 22:00 a 06:00 (Madrid); salida con la pausa abierta. |

Al cerrar el sprint, una **batería de RLS** (pgTAP o tests de integración contra staging) con 2 negocios × 3 roles que se ejecute en cada PR.

## Sprint 2 · TPV, caja, stock y Shopify

Objetivo: que la caja cuadre, el stock no se pierda y Shopify no duplique.

| PR | Hallazgos | Contenido |
|---|---|---|
| `fix/iva-tpv-ticket` | A11 | Un único modelo de IVA incluido; 21 % por defecto. Tests del TPV y del ticket con la venta completa. |
| `fix/caja-arqueo` | M2, F9 | Restar las devoluciones en efectivo; índice único de caja abierta; sin INSERT directo. Exigir caja abierta para cobrar en efectivo (configurable). |
| `feat/movimientos-stock` | A12 | `adjust_stock` + `stock_movements`; el inventario y la importación de Shopify trabajan con incrementos (deltas). |
| `fix/shopify-pos-idempotencia` | A10, M6 | Reservar la venta antes de `orderCreate` y buscar por `sourceIdentifier`. Comprobar los errores de los `update`. El webhook responde 500 si no ha podido encolar. |
| `refactor/shopify-importar-pedido` | M5, F2 | Una sola función `importShopifyOrder()` en `_shared` con tests. La importación del catálogo pasa a la edge function, con upserts por lotes. |
| `fix/shopify-claim` | A9 | «Claim» solo para el super admin o los negocios autorizados. Diseño (sin implementar) de OAuth por tienda para varios clientes. |
| `fix/rls-roles-staff` | M3, F5, F8 | Decidir con el usuario qué puede hacer el staff. Precios y stock solo para admin. Facturas emitidas bloqueadas con un trigger. Estados de factura por RPC. `RequireRole` en la interfaz. |

## Sprint 3 · Calidad, CI y rendimiento

Objetivo: que el repositorio se proteja solo frente a regresiones.

| PR | Hallazgos | Contenido |
|---|---|---|
| `ci/github-actions` | M7, B1 | Workflow con lint, `tsc`, tests, build, gitleaks y `npm audit --omit=dev --audit-level=high` en cada PR. |
| `fix/lint` | M7, F12 | Los 73 errores de lint, empezando por quitar los `as any` de RRHH. |
| `chore/deps` | M8 | `npm audit fix` sin `--force`; react-router a la última 6.x. |
| `refactor/react-query-retail` | F1, F3 | Hooks de Retail (caja, ventas, inventario, perfil de tienda) con `useQuery`/`useMutation`. RPC para el pendiente de cobro. |
| `fix/errores-silenciosos` | F6 | Comprobar `{ error }` en `functions.invoke` y en las RPC citadas. |
| `perf/code-splitting` | B2, B3 | `React.lazy` por módulo y para `/admin`; arreglar el `@import` de fuentes. |
| `chore/limpieza` | F10, F11, B4, B5, M4 | Código muerto, `sanitizeSearchTerm` compartido, `REVOKE` pendientes, `has_platform_role`, README. |
| `test/cobertura-critica` | — | Objetivo: tests en caja, ventas, devoluciones, cobros, fichajes, ausencias, `variantMapping` e importación de Shopify. |

## Fuera de estos 3 sprints (para decidir)

- `strictNullChecks` gradual.
- Integración de Shopify para varios clientes (OAuth por tienda).
- Veri*factu: registro encadenado e inalterable de facturas y tickets. Los sprints 1 y 2 dejan la numeración y la inalterabilidad listas para ello.
