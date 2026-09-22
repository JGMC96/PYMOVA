-- Registro de auditoría para cambios sensibles (permisos, invitaciones, propietarios, configuración)
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

  BEGIN
    _actor := current_setting('app.actor_user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    _actor := NULL;
  END;
  _actor := COALESCE(_actor, auth.uid());

  INSERT INTO public.audit_logs (
    business_id, user_id, actor_user_id, action, table_name, record_id, old_data, new_data
  ) VALUES (
    _bid, auth.uid(), _actor, TG_OP, TG_TABLE_NAME, _rid, _old, _new
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_business_members ON public.business_members;
CREATE TRIGGER trg_audit_business_members
AFTER INSERT OR UPDATE OR DELETE ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_business_invitations ON public.business_invitations;
CREATE TRIGGER trg_audit_business_invitations
AFTER INSERT OR UPDATE OR DELETE ON public.business_invitations
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_businesses ON public.businesses;
CREATE TRIGGER trg_audit_businesses
AFTER UPDATE OR DELETE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_business_settings ON public.business_settings;
CREATE TRIGGER trg_audit_business_settings
AFTER INSERT OR UPDATE OR DELETE ON public.business_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

DROP TRIGGER IF EXISTS trg_audit_shopify_connections ON public.shopify_connections;
CREATE TRIGGER trg_audit_shopify_connections
AFTER INSERT OR UPDATE OR DELETE ON public.shopify_connections
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

-- Lectura enriquecida del registro, solo para owner/admin del negocio
CREATE OR REPLACE FUNCTION public.get_security_audit_log(
  _business_id uuid,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  action text,
  table_name text,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz,
  actor_user_id uuid,
  actor_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.action, a.table_name, a.record_id, a.old_data, a.new_data,
         a.created_at, a.actor_user_id, p.full_name
  FROM public.audit_logs a
  LEFT JOIN public.profiles p ON p.id = a.actor_user_id
  WHERE a.business_id = _business_id
    AND public.has_min_role(_business_id, 'admin'::app_role)
    AND a.table_name IN (
      'business_members','business_invitations','businesses',
      'business_settings','shopify_connections','platform_roles'
    )
  ORDER BY a.created_at DESC
  LIMIT GREATEST(0, LEAST(COALESCE(_limit, 100), 200))
  OFFSET GREATEST(0, COALESCE(_offset, 0));
$$;

REVOKE ALL ON FUNCTION public.get_security_audit_log(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_security_audit_log(uuid, integer, integer) TO authenticated;