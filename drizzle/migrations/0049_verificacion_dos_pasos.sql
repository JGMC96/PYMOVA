-- Verificación en dos pasos (revisión de seguridad del 23/10/2026).
--
-- Quien activa la verificación en dos pasos (un código de una app como Google Authenticator)
-- no puede ver ni tocar los datos de ningún negocio hasta que mete el código: con solo la
-- contraseña, su sesión es de nivel «aal1» y las comprobaciones de pertenencia devuelven
-- falso. Se hace en el servidor (en las funciones que usan todas las políticas y RPC), no
-- solo en la pantalla, para que una contraseña robada no baste ni llamando a la API.
-- Quien no la tiene activada sigue igual.

CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors f
        WHERE f.user_id = auth.uid() AND f.status::text = 'verified'
      );
$$;
REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_member_of_business(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = _business_id
      AND user_id = auth.uid()
      AND is_active = true
  ) AND public.mfa_satisfied()
$$;

CREATE OR REPLACE FUNCTION public.has_business_role(_business_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = _business_id
      AND user_id = auth.uid()
      AND role = _role
      AND is_active = true
  ) AND public.mfa_satisfied()
$$;

CREATE OR REPLACE FUNCTION public.has_min_role(_business_id uuid, _min_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = _business_id
      AND user_id = auth.uid()
      AND is_active = true
      AND (
        role = 'owner'
        OR (role = 'admin' AND _min_role IN ('admin', 'staff'))
        OR (role = 'staff' AND _min_role = 'staff')
      )
  ) AND public.mfa_satisfied()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_platform_role(auth.uid(), 'super_admin') AND public.mfa_satisfied()
$$;

CREATE OR REPLACE FUNCTION public.member_can(_business_id uuid, _perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role app_role;
  _employee_id uuid;
  _p record;
BEGIN
  -- Sin el segundo paso (si lo tiene activado), nada (0049).
  IF NOT public.mfa_satisfied() THEN
    RETURN false;
  END IF;
  IF is_super_admin() THEN
    RETURN true;
  END IF;
  SELECT m.role INTO _role FROM business_members m
  WHERE m.business_id = _business_id AND m.user_id = auth.uid() AND m.is_active;
  IF _role IS NULL THEN
    RETURN false;
  END IF;
  IF _role = 'owner' THEN
    RETURN true;
  END IF;
  SELECT e.id INTO _employee_id FROM hr_employees e
  WHERE e.business_id = _business_id AND e.user_id = auth.uid()
  LIMIT 1;
  IF _employee_id IS NULL THEN
    RETURN _role = 'admin';
  END IF;
  SELECT * INTO _p FROM employee_effective_permissions(_employee_id);
  RETURN COALESCE(CASE _perm
    WHEN 'edit_catalog' THEN _p.can_edit_catalog
    WHEN 'see_costs' THEN _p.can_see_costs
    WHEN 'adjust_stock' THEN _p.can_adjust_stock
  END, false);
END;
$$;
