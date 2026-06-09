
-- Enum for permission type
DO $$ BEGIN
  CREATE TYPE public.permission_type AS ENUM ('late_arrival', 'early_departure', 'personal_errand', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE public.hr_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  permission_type public.permission_type NOT NULL,
  custom_type_label text,
  status public.absence_status NOT NULL DEFAULT 'pending',
  permission_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hours_count numeric(5,2) NOT NULL DEFAULT 0,
  reason text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_permissions_business_status_idx
  ON public.hr_permissions (business_id, status, permission_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_permissions TO authenticated;
GRANT ALL ON public.hr_permissions TO service_role;
ALTER TABLE public.hr_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view permissions"
ON public.hr_permissions FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Users can create their own permission requests"
ON public.hr_permissions FOR INSERT TO authenticated
WITH CHECK (
  public.is_member_of_business(business_id)
  AND EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_permissions.business_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Users can cancel their own pending permissions"
ON public.hr_permissions FOR UPDATE TO authenticated
USING (
  status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_permissions.business_id
      AND e.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id = employee_id
      AND e.business_id = hr_permissions.business_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "Admins manage all permissions"
ON public.hr_permissions FOR ALL TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_hr_permissions_updated_at
BEFORE UPDATE ON public.hr_permissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_hr_permissions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_permissions
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- request_permission RPC
CREATE OR REPLACE FUNCTION public.request_permission(
  _business_id uuid,
  _permission_type public.permission_type,
  _permission_date date,
  _start_time time,
  _end_time time,
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
  _id uuid;
  _hours numeric(5,2);
BEGIN
  _emp_id := public.ensure_hr_employee(_business_id);

  IF _end_time <= _start_time THEN
    RAISE EXCEPTION 'La hora fin debe ser posterior a la hora inicio';
  END IF;

  _hours := ROUND(EXTRACT(EPOCH FROM (_end_time - _start_time))::numeric / 3600, 2);

  INSERT INTO public.hr_permissions (
    business_id, employee_id, permission_type, custom_type_label,
    status, permission_date, start_time, end_time, hours_count, reason, created_by
  ) VALUES (
    _business_id, _emp_id, _permission_type, _custom_label,
    'pending', _permission_date, _start_time, _end_time, _hours, _reason, auth.uid()
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- review_permission RPC
CREATE OR REPLACE FUNCTION public.review_permission(
  _permission_id uuid,
  _approve boolean,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row hr_permissions%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.hr_permissions WHERE id = _permission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permiso no encontrado'; END IF;

  IF NOT public.has_min_role(_row.business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden revisar permisos';
  END IF;

  IF _row.status <> 'pending' THEN
    RAISE EXCEPTION 'El permiso ya fue revisado';
  END IF;

  UPDATE public.hr_permissions
  SET status = CASE WHEN _approve THEN 'approved'::absence_status ELSE 'rejected'::absence_status END,
      reviewer_id = auth.uid(),
      reviewed_at = now(),
      review_notes = _notes,
      updated_at = now()
  WHERE id = _permission_id;
END;
$$;
