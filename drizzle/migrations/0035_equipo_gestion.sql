-- Gestión del equipo (fase 2C): quitar miembros, salir de un negocio, transferir la
-- propiedad y no quedarse nunca sin propietario.
-- - Trigger protect_last_owner: ningún cambio (rol, suspensión o baja) deja el negocio sin
--   un propietario activo. Borrar el negocio entero sigue funcionando.
-- - remove_member: el propietario quita a cualquiera; un administrador, solo a personal.
--   Nadie se quita a sí mismo por aquí (para eso, leave_business).
-- - leave_business: salir de un negocio; el último propietario tiene que transferir antes.
-- - transfer_ownership: el propietario da la propiedad a otro miembro activo y, salvo que
--   pida seguir siéndolo, pasa a administrador.
-- Al salir alguien, su ficha de RR. HH. queda inactiva (se conserva el historial), se cierran
-- sus sesiones de vendedor y, si tenía ese negocio como activo, se le quita.
-- Migración idempotente, sin secretos.

-- 1. Siempre al menos un propietario activo -----------------------------------------
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Solo importa si la fila era un propietario activo y deja de serlo.
  IF NOT (OLD.role = 'owner' AND OLD.is_active) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.is_active THEN
    RETURN NEW;
  END IF;
  -- Al borrar el negocio entero (cascada), el negocio ya no existe: se deja pasar.
  IF NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = OLD.business_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_members m
    WHERE m.business_id = OLD.business_id AND m.role = 'owner' AND m.is_active AND m.id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'El negocio tiene que tener al menos un propietario activo: transfiere antes la propiedad'
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_last_owner ON public.business_members;
CREATE TRIGGER trg_protect_last_owner
BEFORE UPDATE OR DELETE ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

-- 2. Al salir del negocio (interna) ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.retire_member(_business_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM pos_seller_sessions s
  WHERE s.employee_id IN (SELECT e.id FROM hr_employees e WHERE e.business_id = _business_id AND e.user_id = _user_id);
  UPDATE hr_employees SET is_active = false, updated_at = now()
  WHERE business_id = _business_id AND user_id = _user_id AND is_active;
  UPDATE profiles SET active_business_id = NULL
  WHERE id = _user_id AND active_business_id = _business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3. Quitar a un miembro ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_member(_business_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _target business_members%ROWTYPE;
BEGIN
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Para salir tú del negocio usa «Salir del negocio»' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _target FROM business_members m
  WHERE m.business_id = _business_id AND m.user_id = _user_id
  FOR UPDATE;
  IF NOT FOUND OR NOT (
    has_business_role(_business_id, 'owner')
    OR (has_min_role(_business_id, 'admin') AND _target.role = 'staff')
  ) THEN
    RAISE EXCEPTION 'No puedes quitar a esta persona del negocio' USING ERRCODE = '42501';
  END IF;

  DELETE FROM business_members WHERE id = _target.id;
  PERFORM retire_member(_business_id, _user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated, service_role;

-- 4. Salir de un negocio -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_business(_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM business_members m WHERE m.business_id = _business_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'No eres miembro de este negocio' USING ERRCODE = '42501';
  END IF;
  -- Si es el último propietario, protect_last_owner lo impide.
  DELETE FROM business_members WHERE business_id = _business_id AND user_id = auth.uid();
  PERFORM retire_member(_business_id, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.leave_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_business(uuid) TO authenticated, service_role;

-- 5. Transferir la propiedad ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_ownership(_business_id uuid, _new_owner uuid, _keep_owner boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo un propietario puede transferir la propiedad' USING ERRCODE = '42501';
  END IF;
  IF _new_owner IS NULL OR _new_owner = auth.uid() THEN
    RAISE EXCEPTION 'Elige a otra persona del equipo' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_members m
    WHERE m.business_id = _business_id AND m.user_id = _new_owner AND m.is_active
  ) THEN
    RAISE EXCEPTION 'La persona tiene que ser un miembro activo del negocio' USING ERRCODE = '22023';
  END IF;

  -- Primero el nuevo propietario; después, si no se queda, el actual pasa a administrador.
  UPDATE business_members SET role = 'owner'
  WHERE business_id = _business_id AND user_id = _new_owner;
  IF NOT COALESCE(_keep_owner, false) THEN
    UPDATE business_members SET role = 'admin'
    WHERE business_id = _business_id AND user_id = auth.uid();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_ownership(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(uuid, uuid, boolean) TO authenticated, service_role;
