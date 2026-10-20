-- Vendedores en el TPV: quién atiende cada venta, cambio de dependiente con PIN y
-- ventas por vendedor.
-- - Un dependiente es una fila de hr_employees. Puede no tener cuenta (user_id nulo y
--   display_name): el admin lo da de alta con nombre y PIN, y solo vende y ficha en el TPV.
-- - El PIN se guarda cifrado (bcrypt, pgcrypto) en hr_employee_pins, sin acceso del cliente.
--   Tras 5 fallos, 5 minutos de bloqueo.
-- - Con el PIN se abre una sesión de vendedor (pos_seller_sessions) ligada a la cuenta que
--   tiene el TPV abierto y al negocio; caduca a las 14 h. La venta lleva el id de la sesión
--   y el servidor resuelve el vendedor: el cliente no puede poner una venta a nombre de otro.
-- - Sin sesión, la venta queda a nombre del empleado de la cuenta, si lo tiene.
-- Migración idempotente, sin secretos.

-- 1. Empleados sin cuenta ------------------------------------------------------------
ALTER TABLE public.hr_employees ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS display_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hr_employees_name_or_account'
  ) THEN
    ALTER TABLE public.hr_employees
      ADD CONSTRAINT hr_employees_name_or_account
      CHECK (user_id IS NOT NULL OR btrim(COALESCE(display_name, '')) <> '');
  END IF;
END
$$;

-- Nombre visible: el propio si no tiene cuenta; si la tiene, el de su perfil.
CREATE OR REPLACE FUNCTION public.employee_display_name(_employee_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(NULLIF(btrim(e.display_name), ''), NULLIF(btrim(p.full_name), ''), 'Sin nombre')
  FROM hr_employees e
  LEFT JOIN profiles p ON p.id = e.user_id
  WHERE e.id = _employee_id;
$$;
REVOKE ALL ON FUNCTION public.employee_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_display_name(uuid) TO authenticated, service_role;

-- 2. PIN cifrado y sesiones de vendedor (sin acceso desde el cliente) ------------------
CREATE TABLE IF NOT EXISTS public.hr_employee_pins (
  employee_id uuid PRIMARY KEY REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_employee_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_employee_pins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hr_employee_pins TO service_role;

CREATE TABLE IF NOT EXISTS public.pos_seller_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 hours'
);
CREATE INDEX IF NOT EXISTS pos_seller_sessions_business_idx ON public.pos_seller_sessions (business_id, expires_at);
ALTER TABLE public.pos_seller_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_seller_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pos_seller_sessions TO service_role;

-- 3. Vendedor en ventas y devoluciones; historial de reasignaciones --------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS seller_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS seller_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_business_seller_idx ON public.sales (business_id, seller_employee_id);
CREATE INDEX IF NOT EXISTS sale_returns_business_seller_idx ON public.sale_returns (business_id, seller_employee_id);

CREATE TABLE IF NOT EXISTS public.sale_seller_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  from_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  to_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  changed_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_seller_changes_sale_idx ON public.sale_seller_changes (sale_id, created_at DESC);
ALTER TABLE public.sale_seller_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_seller_changes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sale_seller_changes FROM authenticated;
GRANT SELECT ON public.sale_seller_changes TO authenticated;
GRANT ALL ON public.sale_seller_changes TO service_role;
DROP POLICY IF EXISTS "Admins view seller changes" ON public.sale_seller_changes;
CREATE POLICY "Admins view seller changes" ON public.sale_seller_changes
  FOR SELECT TO authenticated USING (public.has_min_role(business_id, 'admin'));

-- 4. Gestión de dependientes (admins) --------------------------------------------------
-- Alta o cambio de un dependiente sin cuenta. En los que tienen cuenta solo cambia is_active.
CREATE OR REPLACE FUNCTION public.upsert_pos_employee(
  _business_id uuid,
  _employee_id uuid,
  _display_name text,
  _is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp hr_employees%ROWTYPE;
  _name text := btrim(COALESCE(_display_name, ''));
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar los dependientes' USING ERRCODE = '42501';
  END IF;

  IF _employee_id IS NULL THEN
    IF length(_name) < 2 OR length(_name) > 60 THEN
      RAISE EXCEPTION 'El nombre debe tener entre 2 y 60 caracteres' USING ERRCODE = '22023';
    END IF;
    INSERT INTO hr_employees (business_id, user_id, display_name, hire_date, is_active)
    VALUES (_business_id, NULL, _name, CURRENT_DATE, COALESCE(_is_active, true))
    RETURNING id INTO _employee_id;
    RETURN _employee_id;
  END IF;

  SELECT * INTO _emp FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El dependiente no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;

  IF _emp.user_id IS NULL THEN
    IF length(_name) < 2 OR length(_name) > 60 THEN
      RAISE EXCEPTION 'El nombre debe tener entre 2 y 60 caracteres' USING ERRCODE = '22023';
    END IF;
    UPDATE hr_employees SET display_name = _name, is_active = COALESCE(_is_active, is_active), updated_at = now()
    WHERE id = _employee_id;
  ELSE
    UPDATE hr_employees SET is_active = COALESCE(_is_active, is_active), updated_at = now()
    WHERE id = _employee_id;
  END IF;

  IF _is_active = false THEN
    DELETE FROM pos_seller_sessions WHERE employee_id = _employee_id;
  END IF;
  RETURN _employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_pos_employee(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_pos_employee(uuid, uuid, text, boolean) TO authenticated, service_role;

-- PIN de 4 a 6 cifras. Un admin lo pone a cualquiera; cada miembro, al empleado de su cuenta.
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

-- Lista para el selector del TPV y la pestaña Vendedores. Nunca devuelve el hash.
CREATE OR REPLACE FUNCTION public.get_pos_employees(_business_id uuid)
RETURNS TABLE(id uuid, name text, has_pin boolean, is_active boolean, has_account boolean, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id,
         public.employee_display_name(e.id),
         EXISTS (SELECT 1 FROM hr_employee_pins k WHERE k.employee_id = e.id),
         e.is_active,
         e.user_id IS NOT NULL,
         e.user_id
  FROM hr_employees e
  WHERE e.business_id = _business_id AND is_member_of_business(_business_id)
  ORDER BY e.is_active DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.get_pos_employees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_employees(uuid) TO authenticated, service_role;

-- 5. Sesión de vendedor --------------------------------------------------------------
-- Devuelve ok=false con el motivo en vez de fallar, para que el contador de fallos se guarde.
CREATE OR REPLACE FUNCTION public.start_seller_session(_business_id uuid, _employee_id uuid, _pin text)
RETURNS TABLE(ok boolean, error text, locked_seconds integer, session_id uuid, employee_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _emp hr_employees%ROWTYPE;
  _pinrow hr_employee_pins%ROWTYPE;
  _sid uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;

  DELETE FROM pos_seller_sessions s WHERE s.business_id = _business_id AND s.expires_at < now();

  SELECT * INTO _emp FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id AND e.is_active;
  IF FOUND THEN
    SELECT * INTO _pinrow FROM hr_employee_pins k WHERE k.employee_id = _employee_id FOR UPDATE;
  END IF;
  IF _emp.id IS NULL OR _pinrow.employee_id IS NULL THEN
    RETURN QUERY SELECT false, 'PIN incorrecto', 0, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF _pinrow.locked_until IS NOT NULL AND _pinrow.locked_until > now() THEN
    RETURN QUERY SELECT false, 'Demasiados intentos. Espera unos minutos',
      GREATEST(CEIL(EXTRACT(EPOCH FROM (_pinrow.locked_until - now())))::integer, 1), NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF _pin IS NULL OR extensions.crypt(_pin, _pinrow.pin_hash) <> _pinrow.pin_hash THEN
    IF _pinrow.failed_attempts + 1 >= 5 THEN
      UPDATE hr_employee_pins SET failed_attempts = 0, locked_until = now() + interval '5 minutes', updated_at = now()
      WHERE hr_employee_pins.employee_id = _employee_id;
      RETURN QUERY SELECT false, 'Demasiados intentos. Espera unos minutos', 300, NULL::uuid, NULL::uuid, NULL::text;
    ELSE
      UPDATE hr_employee_pins SET failed_attempts = failed_attempts + 1, updated_at = now()
      WHERE hr_employee_pins.employee_id = _employee_id;
      RETURN QUERY SELECT false, 'PIN incorrecto', 0, NULL::uuid, NULL::uuid, NULL::text;
    END IF;
    RETURN;
  END IF;

  UPDATE hr_employee_pins SET failed_attempts = 0, locked_until = NULL
  WHERE hr_employee_pins.employee_id = _employee_id AND (failed_attempts <> 0 OR locked_until IS NOT NULL);

  INSERT INTO pos_seller_sessions (business_id, employee_id, opened_by)
  VALUES (_business_id, _employee_id, auth.uid())
  RETURNING id INTO _sid;

  RETURN QUERY SELECT true, NULL::text, 0, _sid, _employee_id, public.employee_display_name(_employee_id);
END;
$$;
REVOKE ALL ON FUNCTION public.start_seller_session(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_seller_session(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.end_seller_session(_session_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM pos_seller_sessions s WHERE s.id = _session_id AND s.opened_by = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.end_seller_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_seller_session(uuid) TO authenticated, service_role;

-- Interna (sin GRANT): vendedor de una sesión válida de este negocio abierta por auth.uid().
CREATE OR REPLACE FUNCTION public.seller_from_session(_business_id uuid, _session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _employee_id uuid;
BEGIN
  UPDATE pos_seller_sessions s
  SET last_used_at = now()
  WHERE s.id = _session_id AND s.business_id = _business_id AND s.opened_by = auth.uid() AND s.expires_at > now()
  RETURNING s.employee_id INTO _employee_id;
  IF _employee_id IS NULL THEN
    RAISE EXCEPTION 'La sesión de vendedor no es válida: vuelve a introducir el PIN' USING ERRCODE = '42501';
  END IF;
  RETURN _employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.seller_from_session(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Interna (sin GRANT): el empleado activo de la cuenta con la sesión abierta, si lo tiene.
CREATE OR REPLACE FUNCTION public.default_seller_employee(_business_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id FROM hr_employees e
  WHERE e.business_id = _business_id AND e.user_id = auth.uid() AND e.is_active
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.default_seller_employee(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Ventas con vendedor (cuerpo de la 0021 más _seller_session_id) --------------------
DROP FUNCTION IF EXISTS public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid);

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
  _seller_session_id uuid DEFAULT NULL
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

  _number := generate_sale_number(_business_id);

  INSERT INTO sales (
    business_id, sale_number, client_id, subtotal, tax, total,
    discount, tip, cash_received, change_given, register_session_id,
    payment_method, notes, created_by, seller_employee_id
  ) VALUES (
    _business_id, _number, _client_id, _subtotal_calc, _tax_calc, _total_calc,
    _discount_calc, COALESCE(_tip, 0), _cash_received, _change_given,
    _register_session_id, _payment_method, _notes, auth.uid(), _seller
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

REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid) TO authenticated, service_role;

-- 7. Devoluciones con vendedor (cuerpo de la 0024 más _seller_session_id) --------------
DROP FUNCTION IF EXISTS public.create_sale_return(uuid, uuid, jsonb, text, text, boolean);

CREATE OR REPLACE FUNCTION public.create_sale_return(
  _business_id uuid,
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL,
  _restock boolean DEFAULT true,
  _seller_session_id uuid DEFAULT NULL
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
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio' USING ERRCODE = '42501';
  END IF;
  IF _seller_session_id IS NOT NULL THEN
    _seller := seller_from_session(_business_id, _seller_session_id);
  ELSE
    _seller := default_seller_employee(_business_id);
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

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by, register_session_id, seller_employee_id)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid(), _register_id, _seller)
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

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid) TO authenticated, service_role;

-- 8. Fichar desde el TPV con la sesión de vendedor (cuerpo de la 0020 más _seller_session_id)
DROP FUNCTION IF EXISTS public.clock_action(uuid, public.time_entry_type, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.clock_action(
  _business_id uuid,
  _entry_type public.time_entry_type,
  _latitude numeric DEFAULT NULL,
  _longitude numeric DEFAULT NULL,
  _notes text DEFAULT NULL,
  _seller_session_id uuid DEFAULT NULL
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
  -- Con sesión de vendedor (PIN), ficha ese dependiente; sin ella, la cuenta que ha entrado.
  IF _seller_session_id IS NOT NULL THEN
    _emp_id := public.seller_from_session(_business_id, _seller_session_id);
  ELSE
    _emp_id := public.ensure_hr_employee(_business_id);
  END IF;

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

REVOKE ALL ON FUNCTION public.clock_action(uuid, public.time_entry_type, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clock_action(uuid, public.time_entry_type, numeric, numeric, text, uuid) TO authenticated, service_role;

-- 9. Reasignar el vendedor de una venta (admins, con motivo) ----------------------------
CREATE OR REPLACE FUNCTION public.reassign_sale_seller(_sale_id uuid, _employee_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sale sales%ROWTYPE;
BEGIN
  SELECT * INTO _sale FROM sales s WHERE s.id = _sale_id FOR UPDATE;
  IF NOT FOUND OR NOT has_min_role(_sale.business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede reasignar una venta' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la reasignación' USING ERRCODE = '22023';
  END IF;
  IF _employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _sale.business_id
  ) THEN
    RAISE EXCEPTION 'El dependiente no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;
  IF _sale.seller_employee_id IS NOT DISTINCT FROM _employee_id THEN
    RETURN;
  END IF;

  UPDATE sales SET seller_employee_id = _employee_id WHERE id = _sale_id;
  INSERT INTO sale_seller_changes (business_id, sale_id, from_employee_id, to_employee_id, changed_by, reason)
  VALUES (_sale.business_id, _sale_id, _sale.seller_employee_id, _employee_id, auth.uid(), btrim(_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_sale_seller(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_sale_seller(uuid, uuid, text) TO authenticated, service_role;

-- 10. Ventas por vendedor (admins) ------------------------------------------------------
-- Fechas en la zona horaria del negocio. Las devoluciones se atribuyen a quien las hizo.
CREATE OR REPLACE FUNCTION public.get_sales_by_seller(_business_id uuid, _from date, _to date)
RETURNS TABLE(
  employee_id uuid,
  name text,
  sales_count integer,
  sales_total numeric,
  returns_count integer,
  returns_total numeric,
  net_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las ventas por vendedor' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT s.seller_employee_id AS emp, count(*)::integer AS n, COALESCE(SUM(s.total), 0) AS t
    FROM sales s
    WHERE s.business_id = _business_id
      AND public.business_local_date(_business_id, s.created_at) BETWEEN _from AND _to
    GROUP BY s.seller_employee_id
  ), d AS (
    SELECT r.seller_employee_id AS emp, count(*)::integer AS n, COALESCE(SUM(r.total), 0) AS t
    FROM sale_returns r
    WHERE r.business_id = _business_id
      AND public.business_local_date(_business_id, r.created_at) BETWEEN _from AND _to
    GROUP BY r.seller_employee_id
  ), emps AS (
    SELECT v.emp FROM v UNION SELECT d.emp FROM d
  )
  SELECT e.emp,
         CASE WHEN e.emp IS NULL THEN 'Sin vendedor' ELSE public.employee_display_name(e.emp) END,
         COALESCE(v.n, 0), COALESCE(v.t, 0), COALESCE(d.n, 0), COALESCE(d.t, 0),
         COALESCE(v.t, 0) - COALESCE(d.t, 0)
  FROM emps e
  LEFT JOIN v ON v.emp IS NOT DISTINCT FROM e.emp
  LEFT JOIN d ON d.emp IS NOT DISTINCT FROM e.emp
  ORDER BY COALESCE(v.t, 0) - COALESCE(d.t, 0) DESC, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_by_seller(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_seller(uuid, date, date) TO authenticated, service_role;
