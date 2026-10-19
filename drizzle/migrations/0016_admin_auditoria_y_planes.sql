-- Auditoría de las acciones de super admin y cambios de plan por RPC.
-- - audit_logs: actor_is_super_admin y reason (motivo).
-- - Auditoría en subscriptions, business_modules y platform_roles.
-- - admin_update_subscription: única vía de escritura en subscriptions para el
--   super admin, con validación y motivo obligatorio.
-- - get_platform_audit_log: lectura de la actividad para el panel /admin.
-- Migración idempotente.

-- 1. Columnas nuevas (las filas antiguas quedan en NULL) -----------------------
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_is_super_admin boolean;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS reason text;

-- 2. Funciones de auditoría (cuerpo de la 0015 + super admin y motivo) ---------
CREATE OR REPLACE FUNCTION public.audit_security_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rec jsonb;
  _old jsonb;
  _new jsonb;
  _bid uuid;
  _rid uuid;
  _actor uuid;
  _k text;
BEGIN
  _old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  _new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  _rec := COALESCE(_new, _old);

  -- Nunca guardar secretos en el registro
  FOREACH _k IN ARRAY ARRAY['token','access_token'] LOOP
    IF _old ? _k THEN _old := jsonb_set(_old, ARRAY[_k], '"[oculto]"'::jsonb); END IF;
    IF _new ? _k THEN _new := jsonb_set(_new, ARRAY[_k], '"[oculto]"'::jsonb); END IF;
  END LOOP;

  IF TG_TABLE_NAME = 'businesses' THEN
    _bid := NULLIF(_rec->>'id','')::uuid;
  ELSE
    _bid := NULLIF(_rec->>'business_id','')::uuid;
  END IF;
  _rid := NULLIF(_rec->>'id','')::uuid;

  -- El negocio se está borrando: la fila de auditoría no puede apuntar a él.
  IF _bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = _bid) THEN
    _bid := NULL;
  END IF;

  BEGIN
    _actor := current_setting('app.actor_user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    _actor := NULL;
  END;
  _actor := COALESCE(_actor, auth.uid());

  INSERT INTO public.audit_logs (
    business_id, user_id, actor_user_id, action, table_name, record_id, old_data, new_data,
    actor_is_super_admin, reason
  ) VALUES (
    _bid, auth.uid(), _actor, TG_OP, TG_TABLE_NAME, _rid, _old, _new,
    public.is_super_admin(), NULLIF(current_setting('app.audit_reason', true), '')
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_log_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _business_id uuid;
  _record_id uuid;
  _actor_id uuid;
BEGIN
  BEGIN
    _actor_id := current_setting('app.actor_user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    _actor_id := NULL;
  END;

  _actor_id := COALESCE(_actor_id, auth.uid());

  IF TG_OP = 'DELETE' THEN
    _business_id := OLD.business_id;
    _record_id := OLD.id;
  ELSE
    _business_id := NEW.business_id;
    _record_id := NEW.id;
  END IF;

  -- El negocio se está borrando: la fila de auditoría no puede apuntar a él.
  IF _business_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = _business_id) THEN
    _business_id := NULL;
  END IF;

  INSERT INTO public.audit_logs (
    business_id,
    user_id,
    actor_user_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data,
    actor_is_super_admin,
    reason
  ) VALUES (
    _business_id,
    auth.uid(),
    _actor_id,
    TG_OP,
    TG_TABLE_NAME,
    _record_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    public.is_super_admin(),
    NULLIF(current_setting('app.audit_reason', true), '')
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Auditoría en suscripciones, módulos y roles de plataforma -----------------
DROP TRIGGER IF EXISTS trg_audit_subscriptions ON public.subscriptions;
CREATE TRIGGER trg_audit_subscriptions
AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_business_modules ON public.business_modules;
CREATE TRIGGER trg_audit_business_modules
AFTER INSERT OR UPDATE OR DELETE ON public.business_modules
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_platform_roles ON public.platform_roles;
CREATE TRIGGER trg_audit_platform_roles
AFTER INSERT OR UPDATE OR DELETE ON public.platform_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

-- 4. Cambios de suscripción solo por RPC ---------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_subscription(
  _business_id uuid,
  _reason text,
  _plan_key text DEFAULT NULL,
  _status public.subscription_status DEFAULT NULL,
  _trial_ends_at timestamptz DEFAULT NULL,
  _current_period_end timestamptz DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean_reason text := btrim(coalesce(_reason, ''));
  _plan_id uuid;
  _row public.subscriptions;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Solo un super admin puede cambiar suscripciones' USING ERRCODE = '42501';
  END IF;

  IF char_length(_clean_reason) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo del cambio (mínimo 3 caracteres)' USING ERRCODE = '22023';
  END IF;

  IF _plan_key IS NOT NULL THEN
    SELECT id INTO _plan_id FROM plans WHERE key = _plan_key AND is_active;
    IF _plan_id IS NULL THEN
      RAISE EXCEPTION 'El plan "%" no existe o no está activo', _plan_key USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _plan_id IS NULL AND _status IS NULL AND _trial_ends_at IS NULL AND _current_period_end IS NULL THEN
    RAISE EXCEPTION 'No hay ningún cambio que aplicar' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE business_id = _business_id) THEN
    RAISE EXCEPTION 'El negocio no tiene suscripción' USING ERRCODE = 'P0002';
  END IF;

  -- El motivo lo recogen los triggers de auditoría (también el de los módulos).
  PERFORM set_config('app.audit_reason', _clean_reason, true);

  UPDATE subscriptions
  SET plan_id = COALESCE(_plan_id, plan_id),
      status = COALESCE(_status, status),
      trial_ends_at = COALESCE(_trial_ends_at, trial_ends_at),
      current_period_end = COALESCE(_current_period_end, current_period_end)
  WHERE business_id = _business_id
  RETURNING * INTO _row;

  PERFORM set_config('app.audit_reason', '', true);
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_subscription(uuid, text, text, public.subscription_status, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_subscription(uuid, text, text, public.subscription_status, timestamptz, timestamptz) TO authenticated, service_role;

DROP POLICY IF EXISTS "Super admins can manage all subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Super admins can view all subscriptions" ON public.subscriptions;
CREATE POLICY "Super admins can view all subscriptions"
ON public.subscriptions FOR SELECT
TO authenticated
USING (public.is_super_admin());

-- 5. Actividad de super admin para el panel ------------------------------------
CREATE OR REPLACE FUNCTION public.get_platform_audit_log(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _business_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  table_name text,
  record_id uuid,
  business_id uuid,
  business_name text,
  actor_user_id uuid,
  actor_email text,
  reason text,
  old_data jsonb,
  new_data jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Solo un super admin puede ver la actividad de la plataforma' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH registro AS (
    SELECT a.*,
      COALESCE(
        a.business_id,
        NULLIF(CASE WHEN a.table_name = 'businesses'
                    THEN COALESCE(a.old_data, a.new_data)->>'id'
                    ELSE COALESCE(a.old_data, a.new_data)->>'business_id' END, '')::uuid
      ) AS negocio_id
    FROM audit_logs a
    WHERE a.actor_is_super_admin IS TRUE
  )
  SELECT r.id, r.created_at, r.action, r.table_name, r.record_id, r.negocio_id,
         COALESCE(b.name, CASE WHEN r.table_name = 'businesses'
                               THEN COALESCE(r.old_data, r.new_data)->>'name' END),
         r.actor_user_id, u.email::text, r.reason, r.old_data, r.new_data
  FROM registro r
  LEFT JOIN businesses b ON b.id = r.negocio_id
  LEFT JOIN auth.users u ON u.id = r.actor_user_id
  WHERE (_business_id IS NULL OR r.negocio_id = _business_id)
    -- Acciones de plataforma: tablas de gobierno, cambios con motivo o
    -- actuaciones en negocios de los que el super admin no es miembro.
    AND (
      r.table_name IN ('subscriptions','business_modules','platform_roles','businesses',
                       'business_members','business_invitations')
      OR r.reason IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM business_members m
        WHERE m.business_id = r.negocio_id AND m.user_id = r.actor_user_id AND m.is_active
      )
    )
  ORDER BY r.created_at DESC
  LIMIT GREATEST(0, LEAST(COALESCE(_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(_offset, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_audit_log(integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_audit_log(integer, integer, uuid) TO authenticated, service_role;