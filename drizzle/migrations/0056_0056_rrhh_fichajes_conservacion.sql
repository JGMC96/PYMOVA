-- RR. HH. · El registro de jornada no se puede perder (art. 34.9 ET: se conserva 4 años).
--
-- · Los fichajes (hr_time_entries) no se pueden cambiar nunca, ni borrar mientras tengan
--   menos de 4 años. Las jornadas (hr_work_sessions) tampoco se borran en ese plazo; se
--   corrigen con correct_work_session, con motivo y auditoría (0020).
-- · Nadie borra empleados desde la app: se dan de baja (is_active = false). Un empleado con
--   fichajes de los últimos 4 años no se puede borrar ni con service_role.
-- · Un negocio con fichajes de los últimos 4 años no se puede borrar (propietario ni super admin).
-- · Al dar de baja a un empleado, por cualquier vía (retire_member, upsert_pos_employee o el
--   interruptor «Activo»): su jornada abierta queda cerrada y pendiente de revisión, sin horas,
--   y se borran sus sesiones del TPV y su PIN (si vuelve, se le pone uno nuevo).
-- · get_hr_pending_reviews: jornadas pendientes de revisión o abiertas hace más de 12 h, para
--   que un administrador las cierre.
-- Los triggers de borrado también saltan en los borrados en cascada, así que las claves
-- foráneas se quedan como están. Sin purga automática a los 4 años.
-- Migración idempotente, sin datos de clientes ni secretos.

-- 1. hr_employees: sin DELETE para los usuarios -------------------------------------------
DROP POLICY IF EXISTS "Admins manage employees" ON public.hr_employees;
DROP POLICY IF EXISTS "Admins insert employees" ON public.hr_employees;
DROP POLICY IF EXISTS "Admins update employees" ON public.hr_employees;

CREATE POLICY "Admins insert employees" ON public.hr_employees
  FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE POLICY "Admins update employees" ON public.hr_employees
  FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin'))
  WITH CHECK (public.has_min_role(business_id, 'admin'));

REVOKE ALL ON public.hr_employees FROM anon;
REVOKE DELETE, TRUNCATE ON public.hr_employees FROM authenticated;

-- 2. Plazo de conservación -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_retention_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT now() - interval '4 years';
$$;

-- La usan los triggers de borrado, que corren con el usuario que borra (también en cascada).
REVOKE ALL ON FUNCTION public.hr_retention_start() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_retention_start() TO authenticated, service_role;

-- 3. Fichajes: nunca se cambian; no se borran en el plazo -----------------------------------
CREATE OR REPLACE FUNCTION public.protect_hr_time_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'El registro de jornada no se puede vaciar' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Los fichajes no se pueden modificar: corrige la jornada con un motivo'
      USING ERRCODE = '42501';
  END IF;
  -- DELETE
  IF OLD.occurred_at >= public.hr_retention_start() THEN
    RAISE EXCEPTION 'Los fichajes se conservan 4 años y no se pueden borrar' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_hr_time_entries() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_time_entries_protect ON public.hr_time_entries;
CREATE TRIGGER trg_hr_time_entries_protect
BEFORE UPDATE OR DELETE ON public.hr_time_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_hr_time_entries();

DROP TRIGGER IF EXISTS trg_hr_time_entries_protect_truncate ON public.hr_time_entries;
CREATE TRIGGER trg_hr_time_entries_protect_truncate
BEFORE TRUNCATE ON public.hr_time_entries
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_hr_time_entries();

-- 4. Jornadas: no se borran en el plazo (las correcciones siguen con correct_work_session) ---
CREATE OR REPLACE FUNCTION public.protect_hr_work_sessions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'El registro de jornada no se puede vaciar' USING ERRCODE = '42501';
  END IF;
  IF OLD.clock_in_at >= public.hr_retention_start() THEN
    RAISE EXCEPTION 'Las jornadas se conservan 4 años y no se pueden borrar' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_hr_work_sessions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_work_sessions_protect ON public.hr_work_sessions;
CREATE TRIGGER trg_hr_work_sessions_protect
BEFORE DELETE ON public.hr_work_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_hr_work_sessions();

DROP TRIGGER IF EXISTS trg_hr_work_sessions_protect_truncate ON public.hr_work_sessions;
CREATE TRIGGER trg_hr_work_sessions_protect_truncate
BEFORE TRUNCATE ON public.hr_work_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_hr_work_sessions();

-- 5. Empleados: no se borran si tienen registros en el plazo ---------------------------------
CREATE OR REPLACE FUNCTION public.protect_hr_employees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'La plantilla no se puede vaciar' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hr_time_entries t
             WHERE t.employee_id = OLD.id AND t.occurred_at >= public.hr_retention_start())
     OR EXISTS (SELECT 1 FROM hr_work_sessions s
                WHERE s.employee_id = OLD.id AND s.clock_in_at >= public.hr_retention_start()) THEN
    RAISE EXCEPTION 'Este empleado tiene registros de jornada de los últimos 4 años: dalo de baja en vez de borrarlo'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_hr_employees() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_employees_protect ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_protect
BEFORE DELETE ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.protect_hr_employees();

DROP TRIGGER IF EXISTS trg_hr_employees_protect_truncate ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_protect_truncate
BEFORE TRUNCATE ON public.hr_employees
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_hr_employees();

-- 6. Negocios: no se borran si tienen registros en el plazo ---------------------------------
-- Va antes de la cascada, así el mensaje es claro y no el de una tabla hija.
CREATE OR REPLACE FUNCTION public.protect_business_hr_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hr_time_entries t
             WHERE t.business_id = OLD.id AND t.occurred_at >= public.hr_retention_start())
     OR EXISTS (SELECT 1 FROM hr_work_sessions s
                WHERE s.business_id = OLD.id AND s.clock_in_at >= public.hr_retention_start()) THEN
    RAISE EXCEPTION 'Este negocio tiene registros de jornada de los últimos 4 años y no se puede borrar: hay que conservarlos'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_business_hr_records() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_businesses_protect_hr_records ON public.businesses;
CREATE TRIGGER trg_businesses_protect_hr_records
BEFORE DELETE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.protect_business_hr_records();

-- 7. Baja de un empleado: jornada abierta a revisión, sin sesiones de TPV ni PIN -------------
CREATE OR REPLACE FUNCTION public.on_hr_employee_deactivated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Como la regla de las 12 h de clock_action: cerrada, pendiente de revisión y sin horas.
  UPDATE hr_work_sessions
  SET status = 'closed', needs_review = true, worked_seconds = 0, last_break_start = NULL, updated_at = now()
  WHERE employee_id = NEW.id AND status = 'open';

  DELETE FROM pos_seller_sessions WHERE employee_id = NEW.id;
  DELETE FROM hr_employee_pins WHERE employee_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.on_hr_employee_deactivated() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hr_employees_deactivated ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_deactivated
AFTER UPDATE OF is_active ON public.hr_employees
FOR EACH ROW
WHEN (OLD.is_active AND NOT NEW.is_active)
EXECUTE FUNCTION public.on_hr_employee_deactivated();

-- 8. Jornadas por revisar (solo administradores) -------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hr_pending_reviews(_business_id uuid)
RETURNS TABLE(
  id uuid,
  employee_id uuid,
  employee_name text,
  session_date date,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  worked_seconds integer,
  break_seconds integer,
  status public.work_session_status,
  needs_review boolean,
  correction_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede revisar jornadas' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.employee_id, public.employee_display_name(s.employee_id), s.session_date,
         s.clock_in_at, s.clock_out_at, s.worked_seconds, s.break_seconds, s.status,
         s.needs_review, s.correction_reason
  FROM hr_work_sessions s
  WHERE s.business_id = _business_id
    AND (s.needs_review OR (s.status = 'open' AND s.clock_in_at < now() - interval '12 hours'))
  ORDER BY s.clock_in_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hr_pending_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hr_pending_reviews(uuid) TO authenticated, service_role;
