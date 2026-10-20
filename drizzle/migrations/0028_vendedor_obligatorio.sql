-- Ninguna venta ni devolución sin saber quién la hace.
-- - En cuanto el negocio tiene algún dependiente activo con PIN, create_sale_with_items y
--   create_sale_return rechazan las llamadas sin sesión de vendedor (lo hace
--   default_seller_employee, que es a la que llaman cuando no llega sesión).
--   En negocios sin dependientes con PIN todo sigue igual.
-- - Quien mete su PIN queda conectado 3 horas en ese TPV (antes 14).
-- - Cada persona puede cambiar su PIN en el TPV con el PIN actual (change_own_pin), con
--   el mismo contador de fallos y bloqueo que al identificarse.
-- Migración idempotente, sin secretos.

-- 1. Sesiones de 3 horas -------------------------------------------------------------
ALTER TABLE public.pos_seller_sessions ALTER COLUMN expires_at SET DEFAULT now() + interval '3 hours';

-- 2. ¿El negocio exige vendedor? (interna) ----------------------------------------------
CREATE OR REPLACE FUNCTION public.business_requires_seller(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hr_employees e
    JOIN hr_employee_pins k ON k.employee_id = e.id
    WHERE e.business_id = _business_id AND e.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.business_requires_seller(uuid) FROM PUBLIC, anon, authenticated;

-- Sin sesión: si el negocio exige vendedor, error; si no, el empleado de la cuenta.
CREATE OR REPLACE FUNCTION public.default_seller_employee(_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _employee_id uuid;
BEGIN
  IF business_requires_seller(_business_id) THEN
    RAISE EXCEPTION 'Falta la sesión de vendedor: identifícate con tu PIN en el TPV' USING ERRCODE = '42501';
  END IF;
  SELECT e.id INTO _employee_id FROM hr_employees e
  WHERE e.business_id = _business_id AND e.user_id = auth.uid() AND e.is_active
  LIMIT 1;
  RETURN _employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.default_seller_employee(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Comprobación del PIN con contador de fallos (interna) ------------------------------
-- Respuesta genérica si el empleado no existe, no es del negocio, está inactivo o no tiene PIN.
CREATE OR REPLACE FUNCTION public.verify_employee_pin(_business_id uuid, _employee_id uuid, _pin text)
RETURNS TABLE(ok boolean, error text, locked_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp hr_employees%ROWTYPE;
  _pinrow hr_employee_pins%ROWTYPE;
BEGIN
  SELECT * INTO _emp FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id AND e.is_active;
  IF FOUND THEN
    SELECT * INTO _pinrow FROM hr_employee_pins k WHERE k.employee_id = _employee_id FOR UPDATE;
  END IF;
  IF _emp.id IS NULL OR _pinrow.employee_id IS NULL THEN
    RETURN QUERY SELECT false, 'PIN incorrecto', 0;
    RETURN;
  END IF;

  IF _pinrow.locked_until IS NOT NULL AND _pinrow.locked_until > now() THEN
    RETURN QUERY SELECT false, 'Demasiados intentos. Espera unos minutos',
      GREATEST(CEIL(EXTRACT(EPOCH FROM (_pinrow.locked_until - now())))::integer, 1);
    RETURN;
  END IF;

  IF _pin IS NULL OR extensions.crypt(_pin, _pinrow.pin_hash) <> _pinrow.pin_hash THEN
    IF _pinrow.failed_attempts + 1 >= 5 THEN
      UPDATE hr_employee_pins SET failed_attempts = 0, locked_until = now() + interval '5 minutes', updated_at = now()
      WHERE hr_employee_pins.employee_id = _employee_id;
      RETURN QUERY SELECT false, 'Demasiados intentos. Espera unos minutos', 300;
    ELSE
      UPDATE hr_employee_pins SET failed_attempts = failed_attempts + 1, updated_at = now()
      WHERE hr_employee_pins.employee_id = _employee_id;
      RETURN QUERY SELECT false, 'PIN incorrecto', 0;
    END IF;
    RETURN;
  END IF;

  UPDATE hr_employee_pins SET failed_attempts = 0, locked_until = NULL
  WHERE hr_employee_pins.employee_id = _employee_id AND (failed_attempts <> 0 OR locked_until IS NOT NULL);
  RETURN QUERY SELECT true, NULL::text, 0;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_employee_pin(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- 4. Identificarse: misma respuesta que en la 0027, con la comprobación común ------------
CREATE OR REPLACE FUNCTION public.start_seller_session(_business_id uuid, _employee_id uuid, _pin text)
RETURNS TABLE(ok boolean, error text, locked_seconds integer, session_id uuid, employee_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _check record;
  _sid uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;

  DELETE FROM pos_seller_sessions s WHERE s.business_id = _business_id AND s.expires_at < now();

  SELECT * INTO _check FROM verify_employee_pin(_business_id, _employee_id, _pin);
  IF NOT _check.ok THEN
    RETURN QUERY SELECT false, _check.error, _check.locked_seconds, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO pos_seller_sessions (business_id, employee_id, opened_by)
  VALUES (_business_id, _employee_id, auth.uid())
  RETURNING id INTO _sid;

  RETURN QUERY SELECT true, NULL::text, 0, _sid, _employee_id, public.employee_display_name(_employee_id);
END;
$$;
REVOKE ALL ON FUNCTION public.start_seller_session(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_seller_session(uuid, uuid, text) TO authenticated, service_role;

-- 5. Cambiar mi PIN en el TPV con el PIN actual -----------------------------------------
CREATE OR REPLACE FUNCTION public.change_own_pin(_business_id uuid, _employee_id uuid, _old_pin text, _new_pin text)
RETURNS TABLE(ok boolean, error text, locked_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _check record;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  IF _new_pin IS NULL OR _new_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'El PIN debe tener entre 4 y 6 cifras' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _check FROM verify_employee_pin(_business_id, _employee_id, _old_pin);
  IF NOT _check.ok THEN
    RETURN QUERY SELECT false, _check.error, _check.locked_seconds;
    RETURN;
  END IF;

  UPDATE hr_employee_pins
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf', 10)), failed_attempts = 0, locked_until = NULL, updated_at = now()
  WHERE hr_employee_pins.employee_id = _employee_id;
  -- Con PIN nuevo, las sesiones abiertas de esa persona dejan de valer.
  DELETE FROM pos_seller_sessions s WHERE s.employee_id = _employee_id;

  RETURN QUERY SELECT true, NULL::text, 0;
END;
$$;
REVOKE ALL ON FUNCTION public.change_own_pin(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_own_pin(uuid, uuid, text, text) TO authenticated, service_role;
