-- Permisos por persona en el TPV (fase 2A).
-- - Cada persona del TPV (hr_employees, con o sin cuenta) tiene un descuento máximo (%) y
--   permiso o no para devolver y para cerrar caja. Los cambia solo el propietario.
--   Por defecto: propietario, todo (no se le puede quitar); administrador, todo;
--   personal y dependientes sin cuenta, descuento máximo del 10 % y nada más.
-- - Los permisos son los de la persona identificada con PIN (sesión de vendedor), no los de
--   la cuenta que tiene el TPV abierto.
-- - Sin permiso, la operación necesita la autorización de alguien que lo tenga: mete su PIN
--   (authorize_action) y recibe un ticket de un solo uso, válido 2 minutos, para esa acción.
--   Queda registrado quién autorizó.
-- - Caja a ciegas: el resumen de la caja abierta solo da importes si hay conectada en el TPV
--   una persona que puede cerrar caja.
-- - El PIN de un propietario solo lo pone él mismo u otro propietario.
-- Solo se aplica en negocios con dependientes con PIN (business_requires_seller, 0028).
-- Migración idempotente, sin secretos.

-- 1. Permisos por persona -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_employee_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL UNIQUE REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  max_discount_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (max_discount_pct BETWEEN 0 AND 100),
  can_return boolean NOT NULL DEFAULT false,
  can_close_register boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_employee_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_employee_permissions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.hr_employee_permissions FROM authenticated;
GRANT SELECT ON public.hr_employee_permissions TO authenticated;
GRANT ALL ON public.hr_employee_permissions TO service_role;
DROP POLICY IF EXISTS "Members view permissions" ON public.hr_employee_permissions;
CREATE POLICY "Members view permissions" ON public.hr_employee_permissions
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));
DROP TRIGGER IF EXISTS trg_hr_employee_permissions_audit ON public.hr_employee_permissions;
CREATE TRIGGER trg_hr_employee_permissions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.hr_employee_permissions
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- Quién autorizó cada excepción.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS authorized_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS authorized_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;
ALTER TABLE public.cash_register_sessions
  ADD COLUMN IF NOT EXISTS closed_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_authorized_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;

-- Permisos efectivos de una persona (interna): los del propietario no se pueden recortar;
-- sin fila propia, los del rol de su cuenta (administrador: todo) o los de personal.
CREATE OR REPLACE FUNCTION public.employee_effective_permissions(_employee_id uuid)
RETURNS TABLE(is_owner boolean, max_discount_pct numeric, can_return boolean, can_close_register boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(m.role = 'owner', false),
    CASE WHEN m.role = 'owner' THEN 100::numeric
         ELSE COALESCE(p.max_discount_pct, CASE WHEN m.role = 'admin' THEN 100 ELSE 10 END)::numeric END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_return, m.role = 'admin', false) END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_close_register, m.role = 'admin', false) END
  FROM hr_employees e
  LEFT JOIN business_members m ON m.business_id = e.business_id AND m.user_id = e.user_id AND m.is_active
  LEFT JOIN hr_employee_permissions p ON p.employee_id = e.id
  WHERE e.id = _employee_id;
$$;
REVOKE ALL ON FUNCTION public.employee_effective_permissions(uuid) FROM PUBLIC, anon, authenticated;

-- Lista para el TPV y la pantalla de permisos (miembros del negocio).
CREATE OR REPLACE FUNCTION public.get_pos_permissions(_business_id uuid)
RETURNS TABLE(
  employee_id uuid,
  name text,
  is_owner boolean,
  has_account boolean,
  customized boolean,
  max_discount_pct numeric,
  can_return boolean,
  can_close_register boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id,
         public.employee_display_name(e.id),
         ep.is_owner,
         e.user_id IS NOT NULL,
         EXISTS (SELECT 1 FROM hr_employee_permissions p WHERE p.employee_id = e.id),
         ep.max_discount_pct,
         ep.can_return,
         ep.can_close_register
  FROM hr_employees e
  CROSS JOIN LATERAL public.employee_effective_permissions(e.id) ep
  WHERE e.business_id = _business_id AND e.is_active AND is_member_of_business(_business_id)
  ORDER BY ep.is_owner DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.get_pos_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_permissions(uuid) TO authenticated, service_role;

-- Solo el propietario cambia permisos, y nunca los de un propietario.
CREATE OR REPLACE FUNCTION public.set_employee_permissions(
  _business_id uuid,
  _employee_id uuid,
  _max_discount_pct numeric,
  _can_return boolean,
  _can_close_register boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _is_owner boolean;
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede cambiar los permisos' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id) THEN
    RAISE EXCEPTION 'La persona no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;
  SELECT p.is_owner INTO _is_owner FROM employee_effective_permissions(_employee_id) p;
  IF _is_owner THEN
    RAISE EXCEPTION 'Los permisos de un propietario no se pueden cambiar' USING ERRCODE = '22023';
  END IF;
  IF _max_discount_pct IS NULL OR _max_discount_pct < 0 OR _max_discount_pct > 100 THEN
    RAISE EXCEPTION 'El descuento máximo debe estar entre 0 y 100' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hr_employee_permissions (business_id, employee_id, max_discount_pct, can_return, can_close_register, updated_by)
  VALUES (_business_id, _employee_id, ROUND(_max_discount_pct, 2), COALESCE(_can_return, false), COALESCE(_can_close_register, false), auth.uid())
  ON CONFLICT (employee_id) DO UPDATE
    SET max_discount_pct = EXCLUDED.max_discount_pct,
        can_return = EXCLUDED.can_return,
        can_close_register = EXCLUDED.can_close_register,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_employee_permissions(uuid, uuid, numeric, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_permissions(uuid, uuid, numeric, boolean, boolean) TO authenticated, service_role;

-- 2. Autorizaciones de un solo uso --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('discount', 'return', 'close_register')),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  max_amount numeric,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS pos_authorizations_business_idx ON public.pos_authorizations (business_id, created_at DESC);
ALTER TABLE public.pos_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_authorizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pos_authorizations TO service_role;

-- Un encargado autoriza con su PIN. Respuesta sin excepción para que el contador de
-- fallos del PIN se guarde (como start_seller_session).
CREATE OR REPLACE FUNCTION public.authorize_action(
  _business_id uuid,
  _employee_id uuid,
  _pin text,
  _action text,
  _amount numeric DEFAULT NULL
)
RETURNS TABLE(ok boolean, error text, locked_seconds integer, authorization_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _check record;
  _perm record;
  _allowed boolean;
  _id uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  IF _action IS NULL OR _action NOT IN ('discount', 'return', 'close_register') THEN
    RAISE EXCEPTION 'Acción no válida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _check FROM verify_employee_pin(_business_id, _employee_id, _pin);
  IF NOT _check.ok THEN
    RETURN QUERY SELECT false, _check.error, _check.locked_seconds, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO _perm FROM employee_effective_permissions(_employee_id);
  _allowed := CASE _action
    WHEN 'discount' THEN COALESCE(_perm.max_discount_pct, 0) >= COALESCE(_amount, 100)
    WHEN 'return' THEN COALESCE(_perm.can_return, false)
    WHEN 'close_register' THEN COALESCE(_perm.can_close_register, false)
  END;
  IF NOT _allowed THEN
    RETURN QUERY SELECT false, public.employee_display_name(_employee_id) || ' no tiene permiso para autorizarlo', 0, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  DELETE FROM pos_authorizations a WHERE a.business_id = _business_id AND a.expires_at < now() - interval '1 day';
  INSERT INTO pos_authorizations (business_id, action, employee_id, max_amount, requested_by)
  VALUES (_business_id, _action, _employee_id, _amount, auth.uid())
  RETURNING id INTO _id;

  RETURN QUERY SELECT true, NULL::text, 0, _id, public.employee_display_name(_employee_id);
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_action(uuid, uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_action(uuid, uuid, text, text, numeric) TO authenticated, service_role;

-- Gasta la autorización (interna): una vez, para esa acción, de esa cuenta y en 2 minutos.
-- Para un descuento, el tope autorizado debe cubrir el descuento de la venta.
CREATE OR REPLACE FUNCTION public.consume_authorization(_business_id uuid, _authorization_id uuid, _action text, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _employee_id uuid;
BEGIN
  UPDATE pos_authorizations a
  SET used_at = now()
  WHERE a.id = _authorization_id
    AND a.business_id = _business_id
    AND a.action = _action
    AND a.requested_by = auth.uid()
    AND a.used_at IS NULL
    AND a.expires_at > now()
    AND (_amount IS NULL OR COALESCE(a.max_amount, 100) >= _amount)
  RETURNING a.employee_id INTO _employee_id;
  IF _employee_id IS NULL THEN
    RAISE EXCEPTION 'Necesita autorización: la autorización no es válida o ha caducado' USING ERRCODE = '42501';
  END IF;
  RETURN _employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_authorization(uuid, uuid, text, numeric) FROM PUBLIC, anon, authenticated;

-- 5. Ventas: descuento con tope (cuerpo de la 0027 más _authorization_id) ---------------
DROP FUNCTION IF EXISTS public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_sale_with_items(
  _business_id uuid,
  _items jsonb,
  _payment_method text DEFAULT 'cash',
  _client_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _subtotal numeric DEFAULT 0,
  _tax numeric DEFAULT 0,
  _total numeric DEFAULT 0,
  _discount numeric DEFAULT 0,
  _tip numeric DEFAULT 0,
  _cash_received numeric DEFAULT NULL,
  _change_given numeric DEFAULT NULL,
  _register_session_id uuid DEFAULT NULL,
  _seller_session_id uuid DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS TABLE(sale_id uuid, sale_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _sale_id uuid;
  _number text;
  _tax_rate numeric;
  _register_status text;
  _item jsonb;
  _pid uuid;
  _vid uuid;
  _variant_product uuid;
  _qty numeric;
  _price numeric;
  _cost numeric;
  _catalog_name text;
  _line_name text;
  _gross numeric;
  _net numeric;
  _line_discount numeric;
  _net_sum numeric := 0;
  _discount_calc numeric := 0;
  _subtotal_calc numeric;
  _tax_calc numeric;
  _total_calc numeric;
  _lines jsonb := '[]'::jsonb;
  _seller uuid;
  _discount_pct numeric;
  _max_pct numeric;
  _authorizer uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas en este negocio' USING ERRCODE = '42501';
  END IF;

  -- Vendedor: el de la sesión de vendedor (PIN) o, sin ella, el empleado de la cuenta.
  IF _seller_session_id IS NOT NULL THEN
    _seller := seller_from_session(_business_id, _seller_session_id);
  ELSE
    _seller := default_seller_employee(_business_id);
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos una línea' USING ERRCODE = '22023';
  END IF;

  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c WHERE c.id = _client_id AND c.business_id = _business_id
  ) THEN
    RAISE EXCEPTION 'El cliente no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;

  IF _register_session_id IS NOT NULL THEN
    SELECT s.status INTO _register_status
    FROM cash_register_sessions s
    WHERE s.id = _register_session_id AND s.business_id = _business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La caja no pertenece a este negocio' USING ERRCODE = '42501';
    END IF;
    IF _register_status <> 'open' THEN
      RAISE EXCEPTION 'La caja está cerrada' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Sin caja indicada: la venta va a la caja abierta del negocio, si la hay.
    SELECT s.id INTO _register_session_id
    FROM cash_register_sessions s
    WHERE s.business_id = _business_id AND s.status = 'open'
    LIMIT 1;
  END IF;

  IF _register_session_id IS NULL AND COALESCE(_payment_method, 'cash') = 'cash' THEN
    RAISE EXCEPTION 'Abre la caja para cobrar en efectivo' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(_tip, 0) < 0 THEN
    RAISE EXCEPTION 'La propina no puede ser negativa' USING ERRCODE = '22023';
  END IF;

  -- Mismo tipo de IVA que usa el TPV (business_settings.tax_rate; 21 si no hay fila)
  SELECT COALESCE(bs.tax_rate, 21) INTO _tax_rate FROM business_settings bs WHERE bs.business_id = _business_id;
  IF NOT FOUND THEN _tax_rate := 21; END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _pid := NULLIF(NULLIF(_item->>'product_id', ''), 'null')::uuid;
    _vid := NULLIF(NULLIF(_item->>'variant_id', ''), 'null')::uuid;
    _qty := COALESCE((_item->>'quantity')::numeric, 1);
    _line_name := NULLIF(btrim(COALESCE(_item->>'product_name', '')), '');

    IF _qty <= 0 THEN
      RAISE EXCEPTION 'La cantidad de "%" debe ser mayor que 0', COALESCE(_line_name, 'la línea') USING ERRCODE = '22023';
    END IF;

    IF _vid IS NOT NULL THEN
      SELECT pv.price, COALESCE(pv.cost_price, p.cost_price), p.name || ' · ' || pv.name, pv.product_id
      INTO _price, _cost, _catalog_name, _variant_product
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = _vid AND pv.business_id = _business_id AND p.business_id = _business_id
        AND pv.is_active AND p.is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La variante "%" no pertenece a este negocio o no está activa', COALESCE(_line_name, _vid::text) USING ERRCODE = '42501';
      END IF;
      IF _pid IS NOT NULL AND _pid <> _variant_product THEN
        RAISE EXCEPTION 'La variante "%" no corresponde al producto indicado', COALESCE(_line_name, _vid::text) USING ERRCODE = '22023';
      END IF;
      _pid := _variant_product;
    ELSIF _pid IS NOT NULL THEN
      SELECT p.price, p.cost_price, p.name
      INTO _price, _cost, _catalog_name
      FROM products p
      WHERE p.id = _pid AND p.business_id = _business_id AND p.is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto "%" no pertenece a este negocio o no está activo', COALESCE(_line_name, _pid::text) USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'Cada línea debe tener un producto del catálogo' USING ERRCODE = '22023';
    END IF;

    -- Precio del catálogo (IVA incluido); el total de la línea que manda el TPV es el neto (bruto − descuento).
    _gross := ROUND(_qty * COALESCE(_price, 0), 2);
    _net := ROUND(COALESCE((_item->>'total')::numeric, _gross), 2);
    _line_discount := ROUND(_gross - _net, 2);
    IF _line_discount < 0 OR _line_discount > _gross THEN
      RAISE EXCEPTION 'El descuento de "%" no cuadra: bruto %, neto %', COALESCE(_line_name, _catalog_name), _gross, _net USING ERRCODE = '22023';
    END IF;

    _net_sum := _net_sum + _net;
    _discount_calc := _discount_calc + _line_discount;
    _lines := _lines || jsonb_build_object(
      'product_id', _pid,
      'variant_id', _vid,
      'product_name', COALESCE(_line_name, _catalog_name),
      'quantity', _qty,
      'unit_price', _price,
      'discount', _line_discount,
      'total', _net,
      'unit_cost', _cost
    );
  END LOOP;

  -- IVA incluido: el total es lo que paga el cliente; base y cuota se deducen de él.
  _total_calc := ROUND(_net_sum, 2);
  _subtotal_calc := ROUND(_total_calc / (1 + _tax_rate / 100), 2);
  _tax_calc := ROUND(_total_calc - _subtotal_calc, 2);

  IF abs(_subtotal_calc - COALESCE(_subtotal, 0)) > 0.02
     OR abs(_discount_calc - COALESCE(_discount, 0)) > 0.02
     OR abs(_tax_calc - COALESCE(_tax, 0)) > 0.02
     OR abs(_total_calc - COALESCE(_total, 0)) > 0.02 THEN
    RAISE EXCEPTION 'Los importes no cuadran. Calculado: base %, descuento %, IVA %, total %. Recibido: %, %, %, %',
      _subtotal_calc, _discount_calc, _tax_calc, _total_calc,
      COALESCE(_subtotal, 0), COALESCE(_discount, 0), COALESCE(_tax, 0), COALESCE(_total, 0)
      USING ERRCODE = '22023';
  END IF;

  IF _cash_received IS NOT NULL AND _cash_received < _total_calc + COALESCE(_tip, 0) THEN
    RAISE EXCEPTION 'El efectivo recibido es menor que el total' USING ERRCODE = '22023';
  END IF;

  -- Descuento por encima del máximo de quien vende: hace falta la autorización (PIN) de
  -- alguien con un máximo suficiente. Solo en negocios con dependientes con PIN.
  IF _seller IS NOT NULL AND _discount_calc > 0 AND business_requires_seller(_business_id) THEN
    _discount_pct := ROUND(_discount_calc / NULLIF(_net_sum + _discount_calc, 0) * 100, 2);
    SELECT p.max_discount_pct INTO _max_pct FROM employee_effective_permissions(_seller) p;
    IF _discount_pct > COALESCE(_max_pct, 0) THEN
      IF _authorization_id IS NULL THEN
        RAISE EXCEPTION 'Necesita autorización: el descuento es del % %% y el máximo de esta persona es del % %%',
          _discount_pct, COALESCE(_max_pct, 0) USING ERRCODE = '42501';
      END IF;
      _authorizer := consume_authorization(_business_id, _authorization_id, 'discount', _discount_pct);
    END IF;
  END IF;

  _number := generate_sale_number(_business_id);

  INSERT INTO sales (
    business_id, sale_number, client_id, subtotal, tax, total,
    discount, tip, cash_received, change_given, register_session_id,
    payment_method, notes, created_by, seller_employee_id, authorized_by_employee_id
  ) VALUES (
    _business_id, _number, _client_id, _subtotal_calc, _tax_calc, _total_calc,
    _discount_calc, COALESCE(_tip, 0), _cash_received, _change_given,
    _register_session_id, _payment_method, _notes, auth.uid(), _seller, _authorizer
  )
  RETURNING id INTO _sale_id;

  INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, quantity, unit_price, discount, total, unit_cost)
  SELECT
    _sale_id,
    NULLIF(l->>'product_id', '')::uuid,
    NULLIF(l->>'variant_id', '')::uuid,
    l->>'product_name',
    (l->>'quantity')::numeric,
    (l->>'unit_price')::numeric,
    (l->>'discount')::numeric,
    (l->>'total')::numeric,
    NULLIF(l->>'unit_cost', '')::numeric
  FROM jsonb_array_elements(_lines) AS l;

  RETURN QUERY SELECT _sale_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid) TO authenticated, service_role;

-- 6. Devoluciones con permiso (cuerpo de la 0027 más _authorization_id) ----------------
DROP FUNCTION IF EXISTS public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.create_sale_return(
  _business_id uuid,
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL,
  _restock boolean DEFAULT true,
  _seller_session_id uuid DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS TABLE(return_id uuid, return_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _return_id uuid;
  _number text;
  _item jsonb;
  _sale_item sale_items%ROWTYPE;
  _qty numeric;
  _already numeric;
  _line_total numeric;
  _unit_net numeric;
  _total numeric := 0;
  _register_id uuid;
  _seller uuid;
  _can_return boolean;
  _authorizer uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio' USING ERRCODE = '42501';
  END IF;
  IF _seller_session_id IS NOT NULL THEN
    _seller := seller_from_session(_business_id, _seller_session_id);
  ELSE
    _seller := default_seller_employee(_business_id);
  END IF;
  -- Sin permiso de devoluciones, hace falta la autorización (PIN) de alguien que lo tenga.
  IF _seller IS NOT NULL AND business_requires_seller(_business_id) THEN
    SELECT p.can_return INTO _can_return FROM employee_effective_permissions(_seller) p;
    IF NOT COALESCE(_can_return, false) THEN
      IF _authorization_id IS NULL THEN
        RAISE EXCEPTION 'Necesita autorización: esta persona no puede hacer devoluciones' USING ERRCODE = '42501';
      END IF;
      _authorizer := consume_authorization(_business_id, _authorization_id, 'return', NULL);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = _sale_id AND s.business_id = _business_id) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) e
    GROUP BY e->>'sale_item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cada línea de la venta solo puede aparecer una vez en la devolución' USING ERRCODE = '22023';
  END IF;
  IF _refund_method IS NOT NULL AND _refund_method NOT IN ('cash', 'card', 'transfer', 'store_credit') THEN
    RAISE EXCEPTION 'Método de reembolso no válido: %', _refund_method USING ERRCODE = '22023';
  END IF;

  -- El dinero sale de la caja abierta; en efectivo, hace falta una.
  SELECT c.id INTO _register_id
  FROM cash_register_sessions c
  WHERE c.business_id = _business_id AND c.status = 'open'
  LIMIT 1;
  IF _refund_method = 'cash' AND _register_id IS NULL THEN
    RAISE EXCEPTION 'Abre la caja para devolver en efectivo' USING ERRCODE = '22023';
  END IF;

  _number := 'DEV-' || LPAD(next_document_number(_business_id, 'return')::text, 6, '0');

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by, register_session_id, seller_employee_id, authorized_by_employee_id)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid(), _register_id, _seller, _authorizer)
  RETURNING id INTO _return_id;

  PERFORM set_config('app.stock_source', 'return', true);
  PERFORM set_config('app.stock_ref', _return_id::text, true);

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _qty := COALESCE((_item->>'quantity')::numeric, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO _sale_item FROM sale_items si
    WHERE si.id = (_item->>'sale_item_id')::uuid AND si.sale_id = _sale_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Línea de venta no encontrada';
    END IF;
    -- Todo lo ya devuelto de esta línea, incluida esta misma devolución.
    SELECT COALESCE(SUM(ri.quantity), 0) INTO _already
    FROM sale_return_items ri
    WHERE ri.sale_item_id = _sale_item.id;
    IF _already + _qty > _sale_item.quantity THEN
      RAISE EXCEPTION 'No puedes devolver más unidades de "%" de las vendidas (% pendientes)',
        _sale_item.product_name, _sale_item.quantity - _already;
    END IF;

    -- Lo cobrado por unidad en esa línea (con su descuento). Se calcula sobre lo acumulado
    -- para que varias devoluciones parciales sumen exactamente el total de la línea.
    _unit_net := COALESCE(_sale_item.total, _sale_item.quantity * _sale_item.unit_price) / _sale_item.quantity;
    _line_total := ROUND((_already + _qty) * _unit_net, 2) - ROUND(_already * _unit_net, 2);

    INSERT INTO sale_return_items (
      return_id, sale_item_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost
    ) VALUES (
      _return_id, _sale_item.id, _sale_item.product_id, _sale_item.variant_id,
      _sale_item.product_name, _qty, _sale_item.unit_price,
      _line_total, _sale_item.unit_cost
    );
    _total := _total + _line_total;
    IF COALESCE(_restock, true) THEN
      IF _sale_item.variant_id IS NOT NULL THEN
        UPDATE product_variants pv SET stock_quantity = pv.stock_quantity + _qty::integer, updated_at = now()
        WHERE pv.id = _sale_item.variant_id;
      ELSIF _sale_item.product_id IS NOT NULL THEN
        UPDATE products p SET stock_quantity = COALESCE(p.stock_quantity, 0) + _qty::integer
        WHERE p.id = _sale_item.product_id AND p.track_inventory = true;
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);

  UPDATE sale_returns sr SET total = _total WHERE sr.id = _return_id;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) TO authenticated, service_role;

-- 7. PIN de un propietario (cuerpo de la 0027 más la comprobación) ---------------------
CREATE OR REPLACE FUNCTION public.set_employee_pin(_business_id uuid, _employee_id uuid, _pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp hr_employees%ROWTYPE;
BEGIN
  SELECT * INTO _emp FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id;
  -- Ojo con los dependientes sin cuenta: user_id nulo nunca debe dar «es el mío».
  IF NOT FOUND OR NOT (has_min_role(_business_id, 'admin') OR (_emp.user_id IS NOT NULL AND _emp.user_id = auth.uid())) THEN
    RAISE EXCEPTION 'No puedes cambiar el PIN de este dependiente' USING ERRCODE = '42501';
  END IF;
  -- El PIN de un propietario solo lo pone él mismo u otro propietario (0030).
  IF EXISTS (
    SELECT 1 FROM business_members m
    WHERE m.business_id = _business_id AND m.user_id = _emp.user_id AND m.role = 'owner' AND m.is_active
  ) AND _emp.user_id IS DISTINCT FROM auth.uid() AND NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo un propietario puede cambiar el PIN de un propietario' USING ERRCODE = '42501';
  END IF;
  IF _pin IS NULL OR _pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'El PIN debe tener entre 4 y 6 cifras' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hr_employee_pins (employee_id, pin_hash)
  VALUES (_employee_id, extensions.crypt(_pin, extensions.gen_salt('bf', 10)))
  ON CONFLICT (employee_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now();

  -- Con PIN nuevo, las sesiones abiertas de ese dependiente dejan de valer.
  DELETE FROM pos_seller_sessions WHERE employee_id = _employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_employee_pin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_pin(uuid, uuid, text) TO authenticated, service_role;

-- 8. Cerrar caja: persona identificada y permiso, o autorización (cuerpo de la 0021) ----
DROP FUNCTION IF EXISTS public.close_register_session(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.close_register_session(
  _session_id uuid,
  _counted_amount numeric,
  _notes text DEFAULT NULL,
  _seller_session_id uuid DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s cash_register_sessions%ROWTYPE;
  _cash_sales numeric;
  _cash_refunds numeric;
  _expected numeric;
  _closer uuid;
  _can_close boolean;
  _authorizer uuid;
BEGIN
  SELECT * INTO _s FROM cash_register_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT is_member_of_business(_s.business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar esta caja' USING ERRCODE = '42501';
  END IF;
  IF _s.status = 'closed' THEN
    RAISE EXCEPTION 'La caja ya está cerrada' USING ERRCODE = '22023';
  END IF;
  IF _counted_amount IS NULL OR _counted_amount < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser negativo' USING ERRCODE = '22023';
  END IF;

  -- Con dependientes con PIN: cierra una persona identificada, con permiso o autorizada.
  IF _seller_session_id IS NOT NULL THEN
    _closer := seller_from_session(_s.business_id, _seller_session_id);
  ELSIF business_requires_seller(_s.business_id) THEN
    RAISE EXCEPTION 'Falta la sesión de vendedor: identifícate con tu PIN en el TPV' USING ERRCODE = '42501';
  END IF;
  IF _closer IS NOT NULL AND business_requires_seller(_s.business_id) THEN
    SELECT p.can_close_register INTO _can_close FROM employee_effective_permissions(_closer) p;
    IF NOT COALESCE(_can_close, false) THEN
      IF _authorization_id IS NULL THEN
        RAISE EXCEPTION 'Necesita autorización: esta persona no puede cerrar la caja' USING ERRCODE = '42501';
      END IF;
      _authorizer := consume_authorization(_s.business_id, _authorization_id, 'close_register', NULL);
    END IF;
  END IF;

  SELECT COALESCE(SUM(s.total + COALESCE(s.tip, 0)), 0) INTO _cash_sales
  FROM sales s
  WHERE s.register_session_id = _session_id AND s.payment_method = 'cash';

  SELECT COALESCE(SUM(r.total), 0) INTO _cash_refunds
  FROM sale_returns r
  WHERE r.register_session_id = _session_id AND r.refund_method = 'cash';

  _expected := ROUND(_s.opening_amount + _cash_sales - _cash_refunds, 2);

  UPDATE cash_register_sessions
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      closed_by_employee_id = _closer,
      close_authorized_by_employee_id = _authorizer,
      counted_amount = ROUND(_counted_amount, 2),
      expected_amount = _expected,
      difference = ROUND(_counted_amount, 2) - _expected,
      notes = _notes,
      updated_at = now()
  WHERE id = _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_register_session(uuid, numeric, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_register_session(uuid, numeric, text, uuid, uuid) TO authenticated, service_role;

-- 9. Resumen de la caja a ciegas (cuerpo de la 0021) -----------------------------------
-- Con la caja abierta y dependientes con PIN, los importes solo salen si entre las
-- sesiones conectadas en el TPV hay alguien que puede cerrar caja. Una caja cerrada se ve.
DROP FUNCTION IF EXISTS public.get_register_summary(uuid);

CREATE OR REPLACE FUNCTION public.get_register_summary(_session_id uuid, _seller_session_ids uuid[] DEFAULT NULL)
RETURNS TABLE(
  payment_method text,
  sales_count bigint,
  total_amount numeric,
  refunds_count bigint,
  refunds_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
  _status text;
  _visible boolean;
BEGIN
  SELECT c.business_id, c.status INTO _business_id, _status FROM cash_register_sessions c WHERE c.id = _session_id;
  IF _business_id IS NULL OR NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esta caja' USING ERRCODE = '42501';
  END IF;

  _visible := _status <> 'open' OR NOT business_requires_seller(_business_id) OR EXISTS (
    SELECT 1 FROM pos_seller_sessions ps
    CROSS JOIN LATERAL employee_effective_permissions(ps.employee_id) ep
    WHERE ps.id = ANY (COALESCE(_seller_session_ids, '{}'::uuid[]))
      AND ps.business_id = _business_id AND ps.opened_by = auth.uid() AND ps.expires_at > now()
      AND ep.can_close_register
  );

  RETURN QUERY
  WITH v AS (
    SELECT COALESCE(s.payment_method, 'other')::text AS m, COUNT(*) AS c, SUM(s.total + COALESCE(s.tip, 0)) AS t
    FROM sales s WHERE s.register_session_id = _session_id GROUP BY 1
  ), d AS (
    SELECT COALESCE(r.refund_method, 'other')::text AS m, COUNT(*) AS c, SUM(r.total) AS t
    FROM sale_returns r WHERE r.register_session_id = _session_id GROUP BY 1
  )
  SELECT COALESCE(v.m, d.m),
         COALESCE(v.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(v.t, 0)::numeric END,
         COALESCE(d.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(d.t, 0)::numeric END
  FROM v FULL JOIN d ON d.m = v.m
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_summary(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_register_summary(uuid, uuid[]) TO authenticated, service_role;
