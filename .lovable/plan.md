
# Módulo de RRHH (Recursos Humanos)

Módulo completo de gestión de personal con fichaje horario, control de ausencias y reportes mensuales. Gated por la clave de módulo `hr` (incluido en planes Pro y Business).

## 1. Base de datos

### Nuevo módulo en catálogo
- Registrar `hr` en `modules` y vincular a planes Pro y Business en `plan_modules`.
- Añadir `'hr'` al tipo `ModuleKey` en `src/types/database.ts`.

### Nuevos tipos enum
- `absence_type`: `vacation`, `sick_leave`, `personal`, `other`
- `absence_status`: `pending`, `approved`, `rejected`, `cancelled`
- `time_entry_type`: `clock_in`, `break_start`, `break_end`, `clock_out`

### Tablas nuevas (en `public`, todas con RLS)

**`hr_employees`** — perfil laboral del miembro del negocio
- `business_id`, `user_id`, `hire_date`, `weekly_hours` (default 40), `annual_vacation_days` (default 22), `is_active`
- Unique (`business_id`, `user_id`)

**`hr_time_entries`** — registros de fichaje
- `business_id`, `employee_id`, `entry_type`, `occurred_at`, `latitude`, `longitude`, `notes`
- Index por (`business_id`, `employee_id`, `occurred_at desc`)

**`hr_work_sessions`** — sesiones diarias calculadas (entrada→salida con pausas)
- `business_id`, `employee_id`, `session_date`, `clock_in_at`, `clock_out_at`, `break_seconds`, `worked_seconds`, `status` (`open`/`closed`)
- Mantenida por trigger sobre `hr_time_entries`

**`hr_absences`** — solicitudes de vacaciones/permisos
- `business_id`, `employee_id`, `absence_type`, `custom_type_label`, `status`, `start_date`, `end_date`, `days_count`, `reason`, `reviewer_id`, `reviewed_at`, `review_notes`

**`hr_schedules`** — turnos planificados (Avanzado)
- `business_id`, `employee_id`, `shift_date`, `start_time`, `end_time`, `notes`

### RLS y GRANTs
- `SELECT`: miembros del negocio (`is_member_of_business`).
- `INSERT/UPDATE` propios fichajes y solicitudes: cualquier miembro activo (sobre su `employee_id`).
- `UPDATE` aprobación/rechazo de ausencias y gestión de empleados/turnos: `has_min_role(business_id, 'admin')`.
- GRANT a `authenticated` y `service_role` en cada tabla.

### Funciones RPC (SECURITY DEFINER)
- `clock_action(_business_id, _entry_type, _lat, _lng, _notes)` — registra fichaje y mantiene `hr_work_sessions`. Valida transiciones (no se puede salir sin haber entrado, etc.).
- `request_absence(_business_id, _type, _custom_label, _start, _end, _reason)` — crea solicitud en estado `pending`, calcula `days_count`.
- `review_absence(_absence_id, _approve boolean, _notes)` — solo admin/owner.
- `get_hr_dashboard(_business_id)` — fichajes activos hoy, pendientes de aprobación, balance de vacaciones del usuario actual.
- `get_employee_monthly_report(_business_id, _employee_id, _year, _month)` — horas trabajadas, ausencias, cumplimiento.

## 2. Frontend

### Tipos (`src/types/database.ts`)
Interfaces `HrEmployee`, `HrTimeEntry`, `HrWorkSession`, `HrAbsence`, `HrSchedule` + enums.

### Hooks (`src/hooks/`)
- `useHrEmployees.ts` — listado de empleados del negocio (admin only para edición).
- `useTimeClock.ts` — estado actual del fichaje del usuario (open session), acciones `clockIn/breakStart/breakEnd/clockOut` con captura de geolocalización via `navigator.geolocation`.
- `useAbsences.ts` — listar solicitudes (filtros por estado/tipo/empleado), crear, aprobar/rechazar.
- `useSchedules.ts` — turnos planificados.
- `useHrReports.ts` — datos de reportes mensuales.
Todos con `requestIdRef` para evitar race conditions.

### Componentes (`src/components/hr/`)
- `HrHeader.tsx` — header con tabs y botón rápido de fichaje.
- `TimeClockCard.tsx` — widget grande con hora actual, estado (Fuera/Trabajando/Pausa), botones Entrada/Pausa/Reanudar/Salida; muestra estado de geolocalización.
- `TimeEntriesList.tsx` — historial de fichajes del usuario.
- `WorkSessionsTable.tsx` — vista admin: sesiones por empleado y día.
- `AbsenceRequestDialog.tsx` — formulario con tipo, fechas (date-range picker), motivo, label personalizado si "Otros".
- `AbsencesList.tsx` — tabla con filtros y acciones aprobar/rechazar (solo admin/owner).
- `AbsenceBadge.tsx` — badges para tipo y estado.
- `VacationBalanceCard.tsx` — días disponibles, usados, pendientes.
- `TeamAbsenceCalendar.tsx` — calendario mensual con ausencias aprobadas del equipo (vista admin).
- `ScheduleCalendar.tsx` — planificación de turnos (admin).
- `MonthlyReport.tsx` — reporte exportable a CSV: horas trabajadas, ausencias, incumplimientos.
- `EmployeeFormDialog.tsx` — admin edita `weekly_hours`, `annual_vacation_days`, `hire_date`.

### Páginas (`src/pages/dashboard/hr/`)
- `HrLayout.tsx` con sub-rutas por tabs:
  - `clock` — Mi fichaje (default)
  - `absences` — Mis solicitudes + (admin) gestión de pendientes
  - `team` — calendario del equipo y empleados (admin)
  - `schedule` — turnos planificados (admin)
  - `reports` — reportes mensuales (admin)
- `src/pages/dashboard/Hr.tsx` — punto de entrada con `RequireModule module="hr"`.

### Navegación
- Añadir item "RRHH" con icono `Clock` en `DashboardSidebar.tsx` (moduleKey `hr`).
- Ruta `/dashboard/hr/*` en `Dashboard.tsx`.

### Permisos UI
- Cualquier miembro activo puede fichar y solicitar ausencias propias.
- Tabs `team`, `schedule`, `reports` y acciones de aprobación: ocultos/bloqueados para `staff` mediante `RequireRole`.

## 3. Geolocalización
- Solicitud opcional: si el usuario rechaza, el fichaje se guarda sin coords y se muestra aviso.
- `navigator.geolocation.getCurrentPosition` con timeout corto (5s) antes de llamar al RPC.
- Coordenadas mostradas en tooltip en historial admin (link a Google Maps).

## 4. Cálculo de balance de vacaciones
- Prorrateado por `hire_date` y `annual_vacation_days`.
- Usados = suma de `days_count` de ausencias `vacation` aprobadas del año en curso.
- Pendientes = ausencias `vacation` con estado `pending`.

## 5. Fuera de alcance (futuro)
- Fichaje por NFC/biometría, integración con relojes físicos.
- Notificaciones email/push de aprobación.
- Multi-aprobador o flujos por departamento.
- Nómina y cálculo salarial.
- Importación/exportación masiva más allá de CSV de reportes.

## Detalles técnicos
- Date utils: `date-fns` (ya en proyecto).
- Date range picker: shadcn Calendar en modo `range` con `pointer-events-auto` dentro del Dialog.
- Validación de formularios: `zod` + `react-hook-form`.
- Audit log: las tablas pasan por `audit_log_changes` añadiendo triggers.
- Memory: registrar nuevo memo `mem://features/hr-module` y actualizar índice.
