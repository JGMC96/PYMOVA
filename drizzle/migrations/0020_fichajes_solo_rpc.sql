-- A4 · Fichajes solo por RPC (docs/AUDITORIA.md).
-- - Nadie escribe directamente en hr_time_entries ni en hr_work_sessions: solo
--   clock_action (fichar) y correct_work_session (admins, con motivo auditado).
-- - El día de la sesión se calcula en la zona horaria del negocio.
-- - La sesión abierta se busca sin depender de la fecha (turnos que pasan de medianoche).
-- - Jornada partida: cada entrada abre una sesión nueva; la pausa entre sesiones no cuenta.
-- - Una sesión abierta más de 12 h queda pendiente de revisión, sin horas contadas.
-- Migración idempotente.

-- 1. Permisos: solo lectura para los miembros ------------------------------------
DROP POLICY IF EXISTS "Users can insert their own time entries" ON public.hr_time_entries;
DROP POLICY IF EXISTS "Admins manage all time entries" ON public.hr_time_entries;
DROP POLICY IF EXISTS "Admins manage work sessions" ON public.hr_work_sessions;

REVOKE ALL ON public.hr_time_entries, public.hr_work_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.hr_time_entries, public.hr_work_sessions FROM authenticated;
GRANT SELECT ON public.hr_time_entries, public.hr_work_sessions TO authenticated;

-- 2. Sesiones: varias por día, una sola abierta, revisión y correcciones ----------
ALTER TABLE public.hr_work_sessions
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS corrected_by uuid,
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS correction_reason text;

DO $$
DECLARE
  _c record;
BEGIN
  FOR _c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.hr_work_sessions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (employee_id, session_date)'
  LOOP
    EXECUTE format('ALTER TABLE public.hr_work_sessions DROP CONSTRAINT %I', _c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS hr_work_sessions_one_open_idx
  ON public.hr_work_sessions (employee_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS hr_work_sessions_emp_date_idx
  ON public.hr_work_sessions (business_id, employee_id, session_date);

DROP TRIGGER IF EXISTS trg_hr_work_sessions_audit ON public.hr_work_sessions;
CREATE TRIGGER trg_hr_work_sessions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_work_sessions
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- 3. Fecha local del negocio ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_local_date(_business_id uuid, _at timestamptz DEFAULT now())
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tz text;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No eres miembro de este negocio' USING ERRCODE = '42501';
  END IF;

  SELECT b.timezone INTO _tz FROM businesses b WHERE b.id = _business_id;

  BEGIN
    RETURN (_at AT TIME ZONE COALESCE(NULLIF(_tz, ''), 'Europe/Madrid'))::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    -- Zona horaria no válida guardada en el negocio: se usa la de España.
    RETURN (_at AT TIME ZONE 'Europe/Madrid')::date;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.business_local_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_local_date(uuid, timestamptz) TO authenticated, service_role;

-- 4. Fichar --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clock_action(
  _business_id uuid,
  _entry_type public.time_entry_type,
  _latitude numeric DEFAULT NULL,
  _longitude numeric DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp_id uuid;
  _entry_id uuid;
  _session hr_work_sessions%ROWTYPE;
  _has_session boolean := false;
  _last_entry public.time_entry_type;
  _now timestamptz := now();
  _break integer;
BEGIN
  _emp_id := public.ensure_hr_employee(_business_id);

  -- Un fichaje a la vez por empleado (dos pulsaciones seguidas no abren dos sesiones).
  PERFORM 1 FROM hr_employees WHERE id = _emp_id FOR UPDATE;

  -- Sesión abierta, sea del día que sea.
  SELECT * INTO _session
  FROM hr_work_sessions
  WHERE employee_id = _emp_id AND status = 'open'
  ORDER BY clock_in_at DESC
  LIMIT 1
  FOR UPDATE;
  _has_session := FOUND;

  IF _has_session THEN
    SELECT te.entry_type INTO _last_entry
    FROM hr_time_entries te
    WHERE te.employee_id = _emp_id AND te.occurred_at >= _session.clock_in_at
    ORDER BY te.occurred_at DESC, te.created_at DESC
    LIMIT 1;
    _last_entry := COALESCE(_last_entry, 'clock_in');

    -- Olvido: más de 12 h abierta. Queda pendiente de revisión y sin horas contadas.
    IF _now - _session.clock_in_at > interval '12 hours' THEN
      IF _entry_type = 'clock_in' THEN
        UPDATE hr_work_sessions
        SET status = 'closed', needs_review = true, worked_seconds = 0, last_break_start = NULL, updated_at = _now
        WHERE id = _session.id;
        _has_session := false;
        _last_entry := NULL;
      ELSIF _entry_type = 'clock_out' THEN
        INSERT INTO hr_time_entries (business_id, employee_id, entry_type, occurred_at, latitude, longitude, notes, created_by)
        VALUES (_business_id, _emp_id, 'clock_out', _now, _latitude, _longitude, _notes, auth.uid())
        RETURNING id INTO _entry_id;
        UPDATE hr_work_sessions
        SET clock_out_at = _now, status = 'closed', needs_review = true, worked_seconds = 0,
            last_break_start = NULL, updated_at = _now
        WHERE id = _session.id;
        RETURN _entry_id;
      ELSE
        RAISE EXCEPTION 'Tu sesión lleva más de 12 h abierta: ficha la salida o pide a un administrador que la corrija'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- Transiciones válidas
  IF _entry_type = 'clock_in' THEN
    IF _has_session THEN
      RAISE EXCEPTION 'Ya tienes una sesión abierta' USING ERRCODE = '22023';
    END IF;
  ELSIF _entry_type = 'break_start' THEN
    IF NOT _has_session OR _last_entry = 'break_start' THEN
      RAISE EXCEPTION 'No puedes iniciar pausa sin estar trabajando' USING ERRCODE = '22023';
    END IF;
  ELSIF _entry_type = 'break_end' THEN
    IF NOT _has_session OR _last_entry IS DISTINCT FROM 'break_start' THEN
      RAISE EXCEPTION 'No hay pausa en curso' USING ERRCODE = '22023';
    END IF;
  ELSIF _entry_type = 'clock_out' THEN
    IF NOT _has_session THEN
      RAISE EXCEPTION 'No hay sesión abierta para cerrar' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO hr_time_entries (business_id, employee_id, entry_type, occurred_at, latitude, longitude, notes, created_by)
  VALUES (_business_id, _emp_id, _entry_type, _now, _latitude, _longitude, _notes, auth.uid())
  RETURNING id INTO _entry_id;

  IF _entry_type = 'clock_in' THEN
    -- Siempre una sesión nueva: la mañana y la tarde de una jornada partida son dos sesiones.
    INSERT INTO hr_work_sessions (business_id, employee_id, session_date, clock_in_at, status)
    VALUES (_business_id, _emp_id, public.business_local_date(_business_id, _now), _now, 'open');

  ELSIF _entry_type = 'break_start' THEN
    UPDATE hr_work_sessions SET last_break_start = _now, updated_at = _now WHERE id = _session.id;

  ELSIF _entry_type = 'break_end' THEN
    UPDATE hr_work_sessions
    SET break_seconds = break_seconds
          + CASE WHEN last_break_start IS NULL THEN 0
                 ELSE GREATEST(EXTRACT(EPOCH FROM (_now - last_break_start))::integer, 0) END,
        last_break_start = NULL,
        updated_at = _now
    WHERE id = _session.id;

  ELSIF _entry_type = 'clock_out' THEN
    -- Si sale estando en pausa, la pausa termina con la salida.
    _break := _session.break_seconds
      + CASE WHEN _session.last_break_start IS NULL THEN 0
             ELSE GREATEST(EXTRACT(EPOCH FROM (_now - _session.last_break_start))::integer, 0) END;
    UPDATE hr_work_sessions
    SET clock_out_at = _now,
        status = 'closed',
        break_seconds = _break,
        last_break_start = NULL,
        worked_seconds = GREATEST(EXTRACT(EPOCH FROM (_now - _session.clock_in_at))::integer - _break, 0),
        updated_at = _now
    WHERE id = _session.id;
  END IF;

  RETURN _entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clock_action(uuid, public.time_entry_type, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clock_action(uuid, public.time_entry_type, numeric, numeric, text) TO authenticated, service_role;

-- 5. Panel de RR. HH. (añade my_pending_reviews) --------------------------------
DROP FUNCTION IF EXISTS public.get_hr_dashboard(uuid);

CREATE FUNCTION public.get_hr_dashboard(_business_id uuid)
RETURNS TABLE(
  my_employee_id uuid,
  my_session_status text,
  my_session_clock_in timestamptz,
  my_last_entry_type public.time_entry_type,
  pending_absences bigint,
  team_on_vacation_today bigint,
  vacation_days_total integer,
  vacation_days_used integer,
  vacation_days_pending integer,
  my_pending_reviews bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp hr_employees%ROWTYPE;
  _emp_id uuid;
  _open hr_work_sessions%ROWTYPE;
  _today date;
  _year_start date;
  _year_end date;
  _last_entry public.time_entry_type;
BEGIN
  IF NOT public.is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver datos de RRHH' USING ERRCODE = '42501';
  END IF;

  _today := public.business_local_date(_business_id, now());
  _year_start := date_trunc('year', _today)::date;
  _year_end := (date_trunc('year', _today) + interval '1 year - 1 day')::date;

  SELECT * INTO _emp FROM hr_employees WHERE business_id = _business_id AND user_id = auth.uid();
  _emp_id := _emp.id;

  SELECT * INTO _open FROM hr_work_sessions
  WHERE employee_id = _emp_id AND status = 'open'
  ORDER BY clock_in_at DESC LIMIT 1;

  IF _open.id IS NOT NULL THEN
    SELECT te.entry_type INTO _last_entry
    FROM hr_time_entries te
    WHERE te.employee_id = _emp_id AND te.occurred_at >= _open.clock_in_at
    ORDER BY te.occurred_at DESC, te.created_at DESC
    LIMIT 1;
    _last_entry := COALESCE(_last_entry, 'clock_in');
  END IF;

  RETURN QUERY
  SELECT
    _emp_id,
    CASE
      WHEN _open.id IS NOT NULL THEN 'open'
      WHEN EXISTS (SELECT 1 FROM hr_work_sessions s WHERE s.employee_id = _emp_id AND s.session_date = _today) THEN 'closed'
      ELSE 'none'
    END,
    _open.clock_in_at,
    _last_entry,
    (SELECT COUNT(*) FROM hr_absences a WHERE a.business_id = _business_id AND a.status = 'pending'),
    (SELECT COUNT(*) FROM hr_absences a
      WHERE a.business_id = _business_id AND a.status = 'approved'
        AND _today BETWEEN a.start_date AND a.end_date),
    COALESCE(_emp.annual_vacation_days, 0),
    COALESCE((
      SELECT SUM(a.days_count)::integer FROM hr_absences a
      WHERE a.employee_id = _emp_id AND a.absence_type = 'vacation' AND a.status = 'approved'
        AND a.start_date >= _year_start AND a.start_date <= _year_end
    ), 0),
    COALESCE((
      SELECT SUM(a.days_count)::integer FROM hr_absences a
      WHERE a.employee_id = _emp_id AND a.absence_type = 'vacation' AND a.status = 'pending'
        AND a.start_date >= _year_start AND a.start_date <= _year_end
    ), 0),
    (SELECT COUNT(*) FROM hr_work_sessions s WHERE s.employee_id = _emp_id AND s.needs_review);
END;
$$;

REVOKE ALL ON FUNCTION public.get_hr_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hr_dashboard(uuid) TO authenticated, service_role;

-- 6. Informe mensual (añade id, needs_review y correction_reason) -----------------
DROP FUNCTION IF EXISTS public.get_employee_monthly_report(uuid, uuid, integer, integer);

CREATE FUNCTION public.get_employee_monthly_report(
  _business_id uuid,
  _employee_id uuid,
  _year integer,
  _month integer
)
RETURNS TABLE(
  session_date date,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  worked_seconds integer,
  break_seconds integer,
  status public.work_session_status,
  id uuid,
  needs_review boolean,
  correction_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _start date := make_date(_year, _month, 1);
  _end date := (make_date(_year, _month, 1) + interval '1 month - 1 day')::date;
BEGIN
  IF NOT public.is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso' USING ERRCODE = '42501';
  END IF;

  -- Solo un admin ve el informe de otro empleado.
  IF NOT public.has_min_role(_business_id, 'admin') AND
     NOT EXISTS (SELECT 1 FROM hr_employees e
                 WHERE e.id = _employee_id AND e.business_id = _business_id AND e.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para ver este reporte' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.session_date, s.clock_in_at, s.clock_out_at, s.worked_seconds, s.break_seconds, s.status,
         s.id, s.needs_review, s.correction_reason
  FROM hr_work_sessions s
  WHERE s.business_id = _business_id
    AND s.employee_id = _employee_id
    AND s.session_date BETWEEN _start AND _end
  ORDER BY s.session_date ASC, s.clock_in_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_monthly_report(uuid, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_monthly_report(uuid, uuid, integer, integer) TO authenticated, service_role;

-- 7. Corrección de una sesión por un admin, con motivo --------------------------
CREATE OR REPLACE FUNCTION public.correct_work_session(
  _session_id uuid,
  _clock_in_at timestamptz,
  _clock_out_at timestamptz,
  _break_seconds integer,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s hr_work_sessions%ROWTYPE;
  _clean_reason text := btrim(COALESCE(_reason, ''));
  _span integer;
  _break integer := COALESCE(_break_seconds, 0);
BEGIN
  SELECT * INTO _s FROM hr_work_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_min_role(_s.business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador del negocio puede corregir fichajes' USING ERRCODE = '42501';
  END IF;

  IF length(_clean_reason) < 5 THEN
    RAISE EXCEPTION 'Indica el motivo de la corrección (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;

  IF _clock_in_at IS NULL OR _clock_out_at IS NULL OR _clock_out_at <= _clock_in_at THEN
    RAISE EXCEPTION 'La salida debe ser posterior a la entrada' USING ERRCODE = '22023';
  END IF;

  IF _clock_out_at > now() THEN
    RAISE EXCEPTION 'La salida no puede ser una hora futura' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hr_work_sessions o
    WHERE o.employee_id = _s.employee_id
      AND o.id <> _s.id
      AND tstzrange(o.clock_in_at,
                    COALESCE(o.clock_out_at, CASE WHEN o.status = 'open' THEN now() ELSE o.clock_in_at END),
                    '[]')
          && tstzrange(_clock_in_at, _clock_out_at, '[)')
  ) THEN
    RAISE EXCEPTION 'La corrección se solapa con otra sesión del empleado' USING ERRCODE = '22023';
  END IF;

  _span := EXTRACT(EPOCH FROM (_clock_out_at - _clock_in_at))::integer;
  IF _break < 0 OR _break >= _span THEN
    RAISE EXCEPTION 'La pausa no puede ser negativa ni igual o mayor que la sesión' USING ERRCODE = '22023';
  END IF;

  -- El motivo queda en audit_logs.reason (mismo mecanismo que la 0016).
  PERFORM set_config('app.audit_reason', _clean_reason, true);

  UPDATE hr_work_sessions
  SET clock_in_at = _clock_in_at,
      clock_out_at = _clock_out_at,
      session_date = public.business_local_date(_s.business_id, _clock_in_at),
      break_seconds = _break,
      last_break_start = NULL,
      worked_seconds = _span - _break,
      status = 'closed',
      needs_review = false,
      corrected_by = auth.uid(),
      corrected_at = now(),
      correction_reason = _clean_reason,
      updated_at = now()
  WHERE id = _s.id;

  PERFORM set_config('app.audit_reason', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.correct_work_session(uuid, timestamptz, timestamptz, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_work_session(uuid, timestamptz, timestamptz, integer, text) TO authenticated, service_role;
