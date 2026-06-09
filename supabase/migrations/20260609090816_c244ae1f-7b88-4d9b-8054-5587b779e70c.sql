
-- ============================================================
-- 1. Register HR module in catalog
-- ============================================================
INSERT INTO public.modules (key, name, description, is_active, display_order)
VALUES ('hr', 'Recursos Humanos', 'Fichaje horario, vacaciones, permisos y reportes', true, 80)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

-- Attach to Pro and Business plans
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT p.id, m.id
FROM public.plans p
CROSS JOIN public.modules m
WHERE m.key = 'hr' AND p.key IN ('pro', 'business')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.absence_type AS ENUM ('vacation', 'sick_leave', 'personal', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.absence_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.time_entry_type AS ENUM ('clock_in', 'break_start', 'break_end', 'clock_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_session_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. hr_employees
-- ============================================================
CREATE TABLE public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  hire_date date,
  weekly_hours numeric(5,2) NOT NULL DEFAULT 40,
  annual_vacation_days integer NOT NULL DEFAULT 22,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employees TO authenticated;
GRANT ALL ON public.hr_employees TO service_role;
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view employees of their business"
ON public.hr_employees FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Admins manage employees"
ON public.hr_employees FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_employees_updated_at
BEFORE UPDATE ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_hr_employees_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- ============================================================
-- 4. hr_time_entries
-- ============================================================
CREATE TABLE public.hr_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  entry_type public.time_entry_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_time_entries_emp_time_idx
  ON public.hr_time_entries (business_id, employee_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_time_entries TO authenticated;
GRANT ALL ON public.hr_time_entries TO service_role;
ALTER TABLE public.hr_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view time entries"
ON public.hr_time_entries FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Users can insert their own time entries"
ON public.hr_time_entries FOR INSERT TO authenticated
WITH CHECK (
  public.is_member_of_business(business_id)
  AND EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_time_entries.business_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Admins manage all time entries"
ON public.hr_time_entries FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_time_entries_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_time_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- ============================================================
-- 5. hr_work_sessions
-- ============================================================
CREATE TABLE public.hr_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz,
  break_seconds integer NOT NULL DEFAULT 0,
  worked_seconds integer NOT NULL DEFAULT 0,
  status public.work_session_status NOT NULL DEFAULT 'open',
  last_break_start timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, session_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_work_sessions TO authenticated;
GRANT ALL ON public.hr_work_sessions TO service_role;
ALTER TABLE public.hr_work_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view work sessions"
ON public.hr_work_sessions FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Admins manage work sessions"
ON public.hr_work_sessions FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_work_sessions_updated_at
BEFORE UPDATE ON public.hr_work_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. hr_absences
-- ============================================================
CREATE TABLE public.hr_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  absence_type public.absence_type NOT NULL,
  custom_type_label text,
  status public.absence_status NOT NULL DEFAULT 'pending',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_count integer NOT NULL,
  reason text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_absences_business_status_idx
  ON public.hr_absences (business_id, status, start_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_absences TO authenticated;
GRANT ALL ON public.hr_absences TO service_role;
ALTER TABLE public.hr_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view absences"
ON public.hr_absences FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Users can create their own absence requests"
ON public.hr_absences FOR INSERT TO authenticated
WITH CHECK (
  public.is_member_of_business(business_id)
  AND EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_absences.business_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Users can cancel their own pending absences"
ON public.hr_absences FOR UPDATE TO authenticated
USING (
  status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_absences.business_id
      AND e.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_absences.business_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Admins manage all absences"
ON public.hr_absences FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_absences_updated_at
BEFORE UPDATE ON public.hr_absences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_hr_absences_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_absences
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- ============================================================
-- 7. hr_schedules
-- ============================================================
CREATE TABLE public.hr_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_schedules_business_date_idx
  ON public.hr_schedules (business_id, shift_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_schedules TO authenticated;
GRANT ALL ON public.hr_schedules TO service_role;
ALTER TABLE public.hr_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view schedules"
ON public.hr_schedules FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Admins manage schedules"
ON public.hr_schedules FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_schedules_updated_at
BEFORE UPDATE ON public.hr_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 8. Helper: ensure employee exists for a user
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_hr_employee(_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _emp_id uuid;
BEGIN
  IF NOT public.is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No eres miembro de este negocio';
  END IF;

  SELECT id INTO _emp_id
  FROM public.hr_employees
  WHERE business_id = _business_id AND user_id = auth.uid();

  IF _emp_id IS NULL THEN
    INSERT INTO public.hr_employees (business_id, user_id, hire_date)
    VALUES (_business_id, auth.uid(), CURRENT_DATE)
    RETURNING id INTO _emp_id;
  END IF;

  RETURN _emp_id;
END;
$$;

-- ============================================================
-- 9. clock_action RPC
-- ============================================================
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
SET search_path = public
AS $$
DECLARE
  _emp_id uuid;
  _entry_id uuid;
  _session hr_work_sessions%ROWTYPE;
  _now timestamptz := now();
  _today date := (_now)::date;
  _last_entry public.time_entry_type;
BEGIN
  _emp_id := public.ensure_hr_employee(_business_id);

  -- Look up today's session (lock if exists)
  SELECT * INTO _session
  FROM public.hr_work_sessions
  WHERE employee_id = _emp_id AND session_date = _today
  FOR UPDATE;

  -- Determine last entry today
  SELECT entry_type INTO _last_entry
  FROM public.hr_time_entries
  WHERE employee_id = _emp_id
    AND occurred_at::date = _today
  ORDER BY occurred_at DESC
  LIMIT 1;

  -- Validate transitions
  IF _entry_type = 'clock_in' THEN
    IF _last_entry IS NOT NULL AND _last_entry <> 'clock_out' THEN
      RAISE EXCEPTION 'Ya tienes una sesión abierta hoy';
    END IF;
  ELSIF _entry_type = 'break_start' THEN
    IF _last_entry IS NULL OR _last_entry IN ('clock_out', 'break_start') THEN
      RAISE EXCEPTION 'No puedes iniciar pausa sin estar trabajando';
    END IF;
  ELSIF _entry_type = 'break_end' THEN
    IF _last_entry IS DISTINCT FROM 'break_start' THEN
      RAISE EXCEPTION 'No hay pausa en curso';
    END IF;
  ELSIF _entry_type = 'clock_out' THEN
    IF _last_entry IS NULL OR _last_entry = 'clock_out' THEN
      RAISE EXCEPTION 'No hay sesión abierta para cerrar';
    END IF;
  END IF;

  -- Insert the entry
  INSERT INTO public.hr_time_entries (
    business_id, employee_id, entry_type, occurred_at, latitude, longitude, notes, created_by
  ) VALUES (
    _business_id, _emp_id, _entry_type, _now, _latitude, _longitude, _notes, auth.uid()
  )
  RETURNING id INTO _entry_id;

  -- Maintain hr_work_sessions
  IF _entry_type = 'clock_in' THEN
    INSERT INTO public.hr_work_sessions (
      business_id, employee_id, session_date, clock_in_at, status
    ) VALUES (
      _business_id, _emp_id, _today, _now, 'open'
    )
    ON CONFLICT (employee_id, session_date) DO UPDATE
      SET clock_in_at = LEAST(hr_work_sessions.clock_in_at, EXCLUDED.clock_in_at),
          status = 'open',
          clock_out_at = NULL,
          updated_at = now();

  ELSIF _entry_type = 'break_start' THEN
    UPDATE public.hr_work_sessions
    SET last_break_start = _now,
        updated_at = now()
    WHERE id = _session.id;

  ELSIF _entry_type = 'break_end' THEN
    IF _session.last_break_start IS NOT NULL THEN
      UPDATE public.hr_work_sessions
      SET break_seconds = break_seconds + GREATEST(EXTRACT(EPOCH FROM (_now - _session.last_break_start))::integer, 0),
          last_break_start = NULL,
          updated_at = now()
      WHERE id = _session.id;
    END IF;

  ELSIF _entry_type = 'clock_out' THEN
    UPDATE public.hr_work_sessions
    SET clock_out_at = _now,
        status = 'closed',
        worked_seconds = GREATEST(EXTRACT(EPOCH FROM (_now - clock_in_at))::integer - break_seconds, 0),
        updated_at = now()
    WHERE id = _session.id;
  END IF;

  RETURN _entry_id;
END;
$$;

-- ============================================================
-- 10. request_absence RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_absence(
  _business_id uuid,
  _absence_type public.absence_type,
  _start_date date,
  _end_date date,
  _custom_label text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _emp_id uuid;
  _absence_id uuid;
  _days integer;
BEGIN
  _emp_id := public.ensure_hr_employee(_business_id);

  IF _end_date < _start_date THEN
    RAISE EXCEPTION 'La fecha fin debe ser igual o posterior a la fecha inicio';
  END IF;

  _days := (_end_date - _start_date) + 1;

  INSERT INTO public.hr_absences (
    business_id, employee_id, absence_type, custom_type_label,
    status, start_date, end_date, days_count, reason, created_by
  ) VALUES (
    _business_id, _emp_id, _absence_type, _custom_label,
    'pending', _start_date, _end_date, _days, _reason, auth.uid()
  )
  RETURNING id INTO _absence_id;

  RETURN _absence_id;
END;
$$;

-- ============================================================
-- 11. review_absence RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.review_absence(
  _absence_id uuid,
  _approve boolean,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _absence hr_absences%ROWTYPE;
BEGIN
  SELECT * INTO _absence
  FROM public.hr_absences
  WHERE id = _absence_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;

  IF NOT public.has_min_role(_absence.business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden revisar solicitudes';
  END IF;

  IF _absence.status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud ya fue revisada';
  END IF;

  UPDATE public.hr_absences
  SET status = CASE WHEN _approve THEN 'approved'::absence_status ELSE 'rejected'::absence_status END,
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      review_notes = _notes,
      updated_at = now()
  WHERE id = _absence_id;
END;
$$;

-- ============================================================
-- 12. get_hr_dashboard RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_hr_dashboard(_business_id uuid)
RETURNS TABLE(
  my_employee_id uuid,
  my_session_status text,
  my_session_clock_in timestamptz,
  my_last_entry_type public.time_entry_type,
  pending_absences bigint,
  team_on_vacation_today bigint,
  vacation_days_total integer,
  vacation_days_used integer,
  vacation_days_pending integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _emp_id uuid;
  _emp hr_employees%ROWTYPE;
  _year_start date := date_trunc('year', CURRENT_DATE)::date;
  _year_end date := (date_trunc('year', CURRENT_DATE) + interval '1 year - 1 day')::date;
BEGIN
  IF NOT public.is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver datos de RRHH';
  END IF;

  SELECT * INTO _emp
  FROM public.hr_employees
  WHERE business_id = _business_id AND user_id = auth.uid();

  _emp_id := _emp.id;

  RETURN QUERY
  SELECT
    _emp_id,
    COALESCE((
      SELECT s.status::text FROM public.hr_work_sessions s
      WHERE s.employee_id = _emp_id AND s.session_date = CURRENT_DATE
    ), 'none'),
    (SELECT s.clock_in_at FROM public.hr_work_sessions s
      WHERE s.employee_id = _emp_id AND s.session_date = CURRENT_DATE),
    (SELECT te.entry_type FROM public.hr_time_entries te
      WHERE te.employee_id = _emp_id AND te.occurred_at::date = CURRENT_DATE
      ORDER BY te.occurred_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM public.hr_absences a
      WHERE a.business_id = _business_id AND a.status = 'pending'),
    (SELECT COUNT(*) FROM public.hr_absences a
      WHERE a.business_id = _business_id AND a.status = 'approved'
      AND CURRENT_DATE BETWEEN a.start_date AND a.end_date),
    COALESCE(_emp.annual_vacation_days, 0),
    COALESCE((
      SELECT SUM(a.days_count)::integer FROM public.hr_absences a
      WHERE a.employee_id = _emp_id AND a.absence_type = 'vacation'
        AND a.status = 'approved'
        AND a.start_date >= _year_start AND a.start_date <= _year_end
    ), 0),
    COALESCE((
      SELECT SUM(a.days_count)::integer FROM public.hr_absences a
      WHERE a.employee_id = _emp_id AND a.absence_type = 'vacation'
        AND a.status = 'pending'
        AND a.start_date >= _year_start AND a.start_date <= _year_end
    ), 0);
END;
$$;

-- ============================================================
-- 13. get_employee_monthly_report RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_employee_monthly_report(
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
  status public.work_session_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start date := make_date(_year, _month, 1);
  _end date := (_start + interval '1 month - 1 day')::date;
BEGIN
  IF NOT public.is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso';
  END IF;

  -- Only admin can see other employees' reports
  IF NOT public.has_min_role(_business_id, 'admin') AND
     NOT EXISTS (SELECT 1 FROM public.hr_employees e
                 WHERE e.id = _employee_id AND e.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No tienes permiso para ver este reporte';
  END IF;

  RETURN QUERY
  SELECT s.session_date, s.clock_in_at, s.clock_out_at,
         s.worked_seconds, s.break_seconds, s.status
  FROM public.hr_work_sessions s
  WHERE s.business_id = _business_id
    AND s.employee_id = _employee_id
    AND s.session_date BETWEEN _start AND _end
  ORDER BY s.session_date ASC;
END;
$$;
