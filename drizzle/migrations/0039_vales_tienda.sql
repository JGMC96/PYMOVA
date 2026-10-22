-- Vales de tienda: al devolver con «Vale de tienda» se crea un vale con código, por lo
-- devuelto y con caducidad de un año. En el TPV se paga con él (todo o parte; el resto con
-- otro método) y lo que sobra queda de saldo. Solo en la tienda (no es tarjeta regalo de
-- Shopify). Cada alta, canje y anulación queda en store_voucher_movements.
--
-- La caja: lo pagado con vale no cuenta como efectivo ni en el resumen ni en el arqueo.

-- 1. Tablas ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 4 AND 40),
  initial_amount numeric(12,2) NOT NULL CHECK (initial_amount > 0),
  balance numeric(12,2) NOT NULL CHECK (balance >= 0 AND balance <= initial_amount),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'void')),
  expires_at timestamptz,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  source_return_id uuid REFERENCES public.sale_returns(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'return' CHECK (origin IN ('return', 'import')),
  created_by uuid,
  created_by_employee_id uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS store_vouchers_code_key ON public.store_vouchers (business_id, upper(code));
CREATE UNIQUE INDEX IF NOT EXISTS store_vouchers_source_return_key ON public.store_vouchers (source_return_id) WHERE source_return_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.store_voucher_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES public.store_vouchers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('issue', 'redeem', 'void', 'import')),
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  return_id uuid REFERENCES public.sale_returns(id) ON DELETE SET NULL,
  employee_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_voucher_movements_voucher_idx ON public.store_voucher_movements (voucher_id, created_at);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS voucher_id uuid REFERENCES public.store_vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_amount numeric(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_voucher_amount_check CHECK (voucher_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lectura para los miembros del negocio; se escribe solo por las funciones.
ALTER TABLE public.store_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_voucher_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_vouchers, public.store_voucher_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.store_vouchers, public.store_voucher_movements TO authenticated;
GRANT ALL ON public.store_vouchers, public.store_voucher_movements TO service_role;
DROP POLICY IF EXISTS "Members view store vouchers" ON public.store_vouchers;
CREATE POLICY "Members view store vouchers" ON public.store_vouchers
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));
DROP POLICY IF EXISTS "Members view store voucher movements" ON public.store_voucher_movements;
CREATE POLICY "Members view store voucher movements" ON public.store_voucher_movements
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));

-- 2. Código del vale: VALE- y 8 caracteres sin los que se confunden (0/O, 1/I/L) ----------
CREATE OR REPLACE FUNCTION public.generate_store_voucher_code(_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  _bytes bytea;
  _code text;
  _i integer;
BEGIN
  LOOP
    _bytes := uuid_send(gen_random_uuid());
    _code := 'VALE-';
    -- Bytes aleatorios de un uuid v4 (el 6 y el 8 llevan la versión y la variante).
    FOR _i IN 0..7 LOOP
      _code := _code || substr(_alphabet, 1 + get_byte(_bytes, (ARRAY[0, 1, 2, 3, 4, 5, 10, 11])[_i + 1]) % length(_alphabet), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM store_vouchers v WHERE v.business_id = _business_id AND upper(v.code) = _code
    );
  END LOOP;
  RETURN _code;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_store_voucher_code(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Consultar un vale por su código (lo escanea o lo escribe quien vende) -----------------
CREATE OR REPLACE FUNCTION public.get_store_voucher(_business_id uuid, _code text)
RETURNS TABLE(id uuid, code text, initial_amount numeric, balance numeric, status text, expires_at timestamptz, expired boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los vales de este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT v.id, v.code, v.initial_amount, v.balance, v.status, v.expires_at,
         (v.expires_at IS NOT NULL AND v.expires_at < now())
  FROM store_vouchers v
  WHERE v.business_id = _business_id AND upper(v.code) = upper(btrim(COALESCE(_code, '')));
END;
$$;
REVOKE ALL ON FUNCTION public.get_store_voucher(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_voucher(uuid, text) TO authenticated, service_role;

-- 4. Anular un vale (propietario o administrador) -------------------------------------------
CREATE OR REPLACE FUNCTION public.void_store_voucher(_business_id uuid, _voucher_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _v store_vouchers%ROWTYPE;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo el propietario o un administrador pueden anular vales' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _v FROM store_vouchers v WHERE v.id = _voucher_id AND v.business_id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vale no encontrado' USING ERRCODE = '22023';
  END IF;
  IF _v.status = 'void' THEN
    RAISE EXCEPTION 'El vale ya está anulado' USING ERRCODE = '22023';
  END IF;
  UPDATE store_vouchers v
  SET status = 'void', balance = 0, voided_at = now(), voided_by = auth.uid(), void_reason = btrim(_reason), updated_at = now()
  WHERE v.id = _v.id;
  INSERT INTO store_voucher_movements (business_id, voucher_id, kind, amount, balance_after, note, created_by)
  VALUES (_business_id, _v.id, 'void', -_v.balance, 0, btrim(_reason), auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.void_store_voucher(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_store_voucher(uuid, uuid, text) TO authenticated, service_role;

-- 5. Venta: pago con vale (cuerpo de la 0038 más _voucher_code y _voucher_amount) ----------
DROP FUNCTION IF EXISTS public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid);

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
  _authorization_id uuid DEFAULT NULL,
  _voucher_code text DEFAULT NULL,
  _voucher_amount numeric DEFAULT NULL
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
  _custom boolean;
  _voucher store_vouchers%ROWTYPE;
  _voucher_amt numeric := 0;
  _due numeric;
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
    _custom := _pid IS NULL AND _vid IS NULL AND COALESCE(_item->>'custom', '') = 'true';

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
    ELSIF _custom THEN
      -- «Varios»: línea libre (outlet, artículos sin subir). Descripción y precio los pone
      -- quien vende; sin coste ni stock, y sin producto, para que no toque inventario.
      -- El TPV ya manda el nombre con «Varios · » delante: se quita para no repetirlo.
      _line_name := NULLIF(btrim(regexp_replace(COALESCE(_line_name, ''), '^Varios\s*·\s*', '', 'i')), '');
      IF _line_name IS NULL THEN
        RAISE EXCEPTION 'Escribe qué se vende en la línea de Varios' USING ERRCODE = '22023';
      END IF;
      IF length(_line_name) > 120 THEN
        RAISE EXCEPTION 'La descripción de Varios no puede pasar de 120 caracteres' USING ERRCODE = '22023';
      END IF;
      _price := ROUND(NULLIF(_item->>'unit_price', '')::numeric, 2);
      IF _price IS NULL OR _price <= 0 OR _price >= 100000 THEN
        RAISE EXCEPTION 'El precio de "%" debe estar entre 0,01 y 99.999,99 €', _line_name USING ERRCODE = '22023';
      END IF;
      _cost := NULL;
      _catalog_name := 'Varios · ' || _line_name;
      _line_name := _catalog_name;
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

  -- Pago con vale de tienda: una parte (o todo) del total sale del saldo del vale; el resto
  -- (más la propina) se cobra con el método indicado. Sin resto, el método es el vale.
  _voucher_amt := ROUND(COALESCE(_voucher_amount, 0), 2);
  IF NULLIF(btrim(COALESCE(_voucher_code, '')), '') IS NOT NULL OR _voucher_amt <> 0 THEN
    IF NULLIF(btrim(COALESCE(_voucher_code, '')), '') IS NULL OR _voucher_amt <= 0 THEN
      RAISE EXCEPTION 'Indica el vale y el importe que se paga con él' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO _voucher FROM store_vouchers v
    WHERE v.business_id = _business_id AND upper(v.code) = upper(btrim(_voucher_code))
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay ningún vale con el código %', btrim(_voucher_code) USING ERRCODE = '22023';
    END IF;
    IF _voucher.status = 'void' THEN
      RAISE EXCEPTION 'El vale % está anulado', _voucher.code USING ERRCODE = '22023';
    END IF;
    IF _voucher.expires_at IS NOT NULL AND _voucher.expires_at < now() THEN
      RAISE EXCEPTION 'El vale % caducó el %', _voucher.code, to_char(_voucher.expires_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF _voucher_amt > _voucher.balance THEN
      RAISE EXCEPTION 'El vale % solo tiene % € de saldo', _voucher.code, _voucher.balance USING ERRCODE = '22023';
    END IF;
    IF _voucher_amt > _total_calc THEN
      RAISE EXCEPTION 'El vale no puede pagar más que el total de la venta (% €)', _total_calc USING ERRCODE = '22023';
    END IF;
  END IF;

  _due := ROUND(_total_calc + COALESCE(_tip, 0) - _voucher_amt, 2);
  IF _voucher_amt > 0 AND _due = 0 THEN
    _payment_method := 'store_credit';
  ELSIF _payment_method = 'store_credit' THEN
    RAISE EXCEPTION 'Faltan % € por cobrar con otro método', _due USING ERRCODE = '22023';
  END IF;

  IF _cash_received IS NOT NULL AND _cash_received < _due THEN
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
    payment_method, notes, created_by, seller_employee_id, authorized_by_employee_id,
    voucher_id, voucher_amount
  ) VALUES (
    _business_id, _number, _client_id, _subtotal_calc, _tax_calc, _total_calc,
    _discount_calc, COALESCE(_tip, 0), _cash_received, _change_given,
    _register_session_id, _payment_method, _notes, auth.uid(), _seller, _authorizer,
    CASE WHEN _voucher_amt > 0 THEN _voucher.id END, _voucher_amt
  )
  RETURNING id INTO _sale_id;

  IF _voucher_amt > 0 THEN
    UPDATE store_vouchers v
    SET balance = v.balance - _voucher_amt,
        status = CASE WHEN v.balance - _voucher_amt = 0 THEN 'used' ELSE 'active' END,
        updated_at = now()
    WHERE v.id = _voucher.id;
    INSERT INTO store_voucher_movements (business_id, voucher_id, kind, amount, balance_after, sale_id, employee_id, created_by)
    VALUES (_business_id, _voucher.id, 'redeem', -_voucher_amt, _voucher.balance - _voucher_amt, _sale_id, _seller, auth.uid());
  END IF;

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
REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric) TO authenticated, service_role;

-- 6. Devolución: con «Vale de tienda» crea el vale (cuerpo de la 0030) ----------------------
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
  _client uuid;
  _voucher_id uuid;
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

  -- Reembolso con vale de tienda: se crea el vale por lo devuelto, con caducidad de un año.
  IF _refund_method = 'store_credit' AND _total > 0 THEN
    SELECT s.client_id INTO _client FROM sales s WHERE s.id = _sale_id;
    INSERT INTO store_vouchers (
      business_id, code, initial_amount, balance, expires_at, client_id, source_return_id,
      origin, created_by, created_by_employee_id
    ) VALUES (
      _business_id, generate_store_voucher_code(_business_id), _total, _total, now() + interval '1 year',
      _client, _return_id, 'return', auth.uid(), _seller
    )
    RETURNING id INTO _voucher_id;
    INSERT INTO store_voucher_movements (business_id, voucher_id, kind, amount, balance_after, return_id, employee_id, created_by)
    VALUES (_business_id, _voucher_id, 'issue', _total, _total, _return_id, _seller, auth.uid());
  END IF;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;
REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) TO authenticated, service_role;

-- 7. Cierre de caja: el vale no es efectivo (cuerpo de la 0030) ---------------------------
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

  -- Lo pagado con vale no entra en el cajón.
  SELECT COALESCE(SUM(s.total + COALESCE(s.tip, 0) - COALESCE(s.voucher_amount, 0)), 0) INTO _cash_sales
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

-- 8. Resumen de la caja con la línea «Vale» (cuerpo de la 0030) ---------------------------
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
  -- Cada venta cuenta en su método por lo cobrado fuera del vale, y en «Vale» por lo que
  -- pagó con él (una venta pagada entera con vale solo cuenta en «Vale»).
  WITH p AS (
    SELECT COALESCE(s.payment_method, 'other')::text AS m, s.total + COALESCE(s.tip, 0) - COALESCE(s.voucher_amount, 0) AS t
    FROM sales s
    WHERE s.register_session_id = _session_id
      AND (COALESCE(s.voucher_amount, 0) = 0 OR s.total + COALESCE(s.tip, 0) - s.voucher_amount > 0)
    UNION ALL
    SELECT 'store_credit', s.voucher_amount
    FROM sales s
    WHERE s.register_session_id = _session_id AND COALESCE(s.voucher_amount, 0) > 0
  ), v AS (
    SELECT p.m, COUNT(*) AS c, SUM(p.t) AS t FROM p GROUP BY 1
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
