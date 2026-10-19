-- A14 · No se podían borrar negocios: los triggers de auditoría insertaban en
-- audit_logs filas con el business_id del negocio que se estaba borrando (el
-- propio negocio y cada fila borrada en cascada), y la FK
-- audit_logs_business_id_fkey las rechazaba.
-- Arreglo: si el negocio ya no existe, la fila de auditoría se guarda con
-- business_id NULL (igual que hace ON DELETE SET NULL con las antiguas). El id
-- sigue en old_data y en record_id. Mismo cuerpo que antes salvo ese IF.
-- Migración idempotente.

-- 1. audit_security_changes (de 0007_security_audit_log.sql) ------------------
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
    business_id, user_id, actor_user_id, action, table_name, record_id, old_data, new_data
  ) VALUES (
    _bid, auth.uid(), _actor, TG_OP, TG_TABLE_NAME, _rid, _old, _new
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- 2. audit_log_changes (de 20260126161816) -----------------------------------
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
    new_data
  ) VALUES (
    _business_id,
    auth.uid(),
    _actor_id,
    TG_OP,
    TG_TABLE_NAME,
    _record_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
