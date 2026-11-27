-- 0065 · Pago mixto: cobrar una venta parte en efectivo y parte con tarjeta.
--
-- Encargo del usuario (27/11/2026): «a la hora de pagar no deja la opción de pagar parte en
-- efectivo y parte en tarjeta». Decisiones: solo efectivo y tarjeta; la devolución, con un solo
-- método; las ventas antiguas se copian a la tabla nueva.
--
-- · sale_payments: una línea por forma de pago de cada venta (sin el vale, que sigue en
--   sales.voucher_amount). La escribe solo create_sale_with_items; se lee con la cuenta del usuario.
-- · sales.payment_method sigue igual para lo de siempre y vale 'mixed' cuando hay dos formas.
-- · create_sale_with_items gana _payments (al final, con DEFAULT NULL): sin él, todo como antes.
-- · Lo que suma por forma de pago reparte las ventas mixtas: efectivo esperado en caja, resumen
--   del cierre, resumen por vendedor e informe de ventas. Las demás ventas se cuentan como antes.
--
-- Aditiva e idempotente.

-- 1. Formas de pago de cada venta ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (length(btrim(method)) BETWEEN 1 AND 30),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  cash_received numeric(12,2),
  change_given numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, method)
);
CREATE INDEX IF NOT EXISTS sale_payments_business_idx ON public.sale_payments (business_id, created_at);

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_payments TO authenticated;
GRANT ALL ON public.sale_payments TO service_role;
DROP POLICY IF EXISTS "Members view sale payments" ON public.sale_payments;
CREATE POLICY "Members view sale payments" ON public.sale_payments
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));

-- Ventas anteriores: una línea con su forma de pago y lo cobrado fuera del vale.
INSERT INTO public.sale_payments (business_id, sale_id, method, amount, cash_received, change_given, created_at)
SELECT s.business_id, s.id, s.payment_method,
       ROUND(s.total + COALESCE(s.tip, 0) - COALESCE(s.voucher_amount, 0), 2),
       CASE WHEN s.payment_method = 'cash' THEN s.cash_received END,
       CASE WHEN s.payment_method = 'cash' THEN s.change_given END,
       s.created_at
FROM public.sales s
WHERE s.payment_method IS NOT NULL
  AND s.payment_method NOT IN ('store_credit', 'mixed')
  AND ROUND(s.total + COALESCE(s.tip, 0) - COALESCE(s.voucher_amount, 0), 2) > 0
ON CONFLICT (sale_id, method) DO NOTHING;

-- 2. Lo cobrado con una forma de pago en una venta -------------------------------------------
-- Una venta mixta, por sus líneas; las demás, como siempre: total + propina − vale si es su método.
CREATE OR REPLACE FUNCTION public.sale_method_amount(_sale public.sales, _method text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _sale.payment_method = 'mixed' THEN COALESCE((
      SELECT sum(sp.amount) FROM sale_payments sp WHERE sp.sale_id = _sale.id AND sp.method = _method), 0)
    WHEN _sale.payment_method = _method THEN _sale.total + COALESCE(_sale.tip, 0) - COALESCE(_sale.voucher_amount, 0)
    ELSE 0
  END;
$$;
REVOKE ALL ON FUNCTION public.sale_method_amount(public.sales, text) FROM PUBLIC, anon, authenticated;

-- 3. Registrar una venta, con el reparto del pago ---------------------------------------------
-- Cambia la firma (parámetro nuevo al final): se quita la anterior para que no queden dos.
DROP FUNCTION IF EXISTS public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric);
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
  _voucher_amount numeric DEFAULT NULL,
  _payments jsonb DEFAULT NULL
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
  _pay jsonb;
  _pay_method text;
  _pay_amount numeric;
  _pay_sum numeric := 0;
  _pay_count integer := 0;
  _pay_cash numeric := 0;
  _pay_lines jsonb := '[]'::jsonb;
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
        AND pv.is_active;
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
      WHERE p.id = _pid AND p.business_id = _business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto "%" no pertenece a este negocio', COALESCE(_line_name, _pid::text) USING ERRCODE = '42501';
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

  -- Pago mixto (0065): lo que queda por cobrar (total + propina − vale) se reparte entre
  -- efectivo y tarjeta. El entregado y el cambio son solo de la parte en efectivo.
  IF _payments IS NOT NULL AND jsonb_typeof(_payments) = 'array' AND jsonb_array_length(_payments) > 0 THEN
    IF _due <= 0 THEN
      RAISE EXCEPTION 'No queda nada por cobrar: no hace falta repartir el pago' USING ERRCODE = '22023';
    END IF;
    FOR _pay IN SELECT * FROM jsonb_array_elements(_payments) LOOP
      _pay_method := btrim(COALESCE(_pay->>'method', ''));
      _pay_amount := ROUND(NULLIF(_pay->>'amount', '')::numeric, 2);
      IF _pay_method NOT IN ('cash', 'card') THEN
        RAISE EXCEPTION 'Solo se puede repartir entre efectivo y tarjeta' USING ERRCODE = '22023';
      END IF;
      IF _pay_amount IS NULL OR _pay_amount <= 0 THEN
        RAISE EXCEPTION 'Cada forma de pago tiene que llevar un importe mayor que 0' USING ERRCODE = '22023';
      END IF;
      IF _pay_lines @> jsonb_build_array(jsonb_build_object('method', _pay_method)) THEN
        RAISE EXCEPTION 'Cada forma de pago solo puede salir una vez' USING ERRCODE = '22023';
      END IF;
      _pay_lines := _pay_lines || jsonb_build_object('method', _pay_method, 'amount', _pay_amount);
      _pay_sum := _pay_sum + _pay_amount;
      _pay_count := _pay_count + 1;
      IF _pay_method = 'cash' THEN _pay_cash := _pay_amount; END IF;
    END LOOP;
    IF ROUND(_pay_sum, 2) <> _due THEN
      RAISE EXCEPTION 'Las formas de pago suman % € y hay que cobrar % €', ROUND(_pay_sum, 2), _due USING ERRCODE = '22023';
    END IF;
    IF _pay_cash > 0 AND _register_session_id IS NULL THEN
      RAISE EXCEPTION 'Abre la caja para cobrar en efectivo' USING ERRCODE = '22023';
    END IF;
    IF _cash_received IS NOT NULL AND (_pay_cash = 0 OR _cash_received < _pay_cash) THEN
      RAISE EXCEPTION 'El efectivo recibido es menor que la parte en efectivo' USING ERRCODE = '22023';
    END IF;
    _payment_method := CASE WHEN _pay_count = 1 THEN _pay_lines->0->>'method' ELSE 'mixed' END;
  ELSE
    IF _payment_method = 'mixed' THEN
      RAISE EXCEPTION 'Indica cuánto se cobra con cada forma de pago' USING ERRCODE = '22023';
    END IF;
    IF _cash_received IS NOT NULL AND _cash_received < _due THEN
      RAISE EXCEPTION 'El efectivo recibido es menor que el total' USING ERRCODE = '22023';
    END IF;
    IF _due > 0 THEN
      _pay_lines := jsonb_build_array(jsonb_build_object('method', COALESCE(_payment_method, 'cash'), 'amount', _due));
      IF COALESCE(_payment_method, 'cash') = 'cash' THEN _pay_cash := _due; END IF;
    END IF;
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

  -- Formas de pago de la venta (0065): una línea por forma de pago, sin el vale.
  INSERT INTO sale_payments (business_id, sale_id, method, amount, cash_received, change_given)
  SELECT _business_id, _sale_id, p->>'method', (p->>'amount')::numeric,
         CASE WHEN p->>'method' = 'cash' THEN _cash_received END,
         CASE WHEN p->>'method' = 'cash' THEN _change_given END
  FROM jsonb_array_elements(_pay_lines) AS p;

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
REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, numeric, jsonb) TO authenticated, service_role;

-- 4. Efectivo esperado en la caja: de las ventas mixtas, solo la parte en efectivo -------------
CREATE OR REPLACE FUNCTION public.register_expected_cash(_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _opening numeric;
  _cash_sales numeric;
  _cash_refunds numeric;
  _movements numeric;
BEGIN
  SELECT c.opening_amount INTO _opening FROM cash_register_sessions c WHERE c.id = _session_id;

  -- Lo pagado con vale no entra en el cajón; de una venta mixta, solo su parte en efectivo.
  SELECT COALESCE(SUM(sale_method_amount(s, 'cash')), 0) INTO _cash_sales
  FROM sales s
  WHERE s.register_session_id = _session_id AND s.payment_method IN ('cash', 'mixed');

  SELECT COALESCE(SUM(r.total), 0) INTO _cash_refunds
  FROM sale_returns r
  WHERE r.register_session_id = _session_id AND r.refund_method = 'cash';

  SELECT COALESCE(SUM(CASE WHEN m.movement_type = 'cash_in' THEN m.amount ELSE -m.amount END), 0) INTO _movements
  FROM cash_movements m
  WHERE m.register_session_id = _session_id AND m.voided_at IS NULL;

  RETURN ROUND(_opening + _cash_sales - _cash_refunds + _movements, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.register_expected_cash(uuid) FROM PUBLIC, anon, authenticated;

-- 5. Resumen del cierre por forma de pago --------------------------------------------------
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
    WHERE s.register_session_id = _session_id AND s.payment_method IS DISTINCT FROM 'mixed'
      AND (COALESCE(s.voucher_amount, 0) = 0 OR s.total + COALESCE(s.tip, 0) - s.voucher_amount > 0)
    UNION ALL
    -- Venta mixta (0065): cuenta en cada forma de pago por su parte.
    SELECT sp.method, sp.amount
    FROM sales s JOIN sale_payments sp ON sp.sale_id = s.id
    WHERE s.register_session_id = _session_id AND s.payment_method = 'mixed'
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

-- 6. Turno por vendedor: el efectivo, sin vale y con la parte de las mixtas -----------------
CREATE OR REPLACE FUNCTION public.get_register_seller_summary(_session_id uuid, _seller_session_ids uuid[] DEFAULT NULL)
RETURNS TABLE(
  employee_id uuid,
  name text,
  sales_count bigint,
  sales_total numeric,
  cash_total numeric,
  refunds_count bigint,
  refunds_total numeric,
  net_total numeric
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

  -- Mismo criterio que get_register_summary (0030).
  _visible := _status <> 'open' OR NOT business_requires_seller(_business_id) OR EXISTS (
    SELECT 1 FROM pos_seller_sessions ps
    CROSS JOIN LATERAL employee_effective_permissions(ps.employee_id) ep
    WHERE ps.id = ANY (COALESCE(_seller_session_ids, '{}'::uuid[]))
      AND ps.business_id = _business_id AND ps.opened_by = auth.uid() AND ps.expires_at > now()
      AND ep.can_close_register
  );

  RETURN QUERY
  WITH v AS (
    SELECT s.seller_employee_id AS emp, COUNT(*) AS c,
           SUM(s.total + COALESCE(s.tip, 0)) AS t,
           -- Lo cobrado en efectivo (sin el vale; de una mixta, su parte en efectivo; 0065).
           SUM(sale_method_amount(s, 'cash')) AS cash
    FROM sales s WHERE s.register_session_id = _session_id GROUP BY 1
  ), d AS (
    SELECT r.seller_employee_id AS emp, COUNT(*) AS c, SUM(r.total) AS t
    FROM sale_returns r WHERE r.register_session_id = _session_id GROUP BY 1
  ), emps AS (
    SELECT v.emp FROM v UNION SELECT d.emp FROM d
  )
  SELECT e.emp,
         CASE WHEN e.emp IS NULL THEN 'Sin vendedor' ELSE public.employee_display_name(e.emp) END,
         COALESCE(v.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(v.t, 0)::numeric END,
         CASE WHEN _visible THEN COALESCE(v.cash, 0)::numeric END,
         COALESCE(d.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(d.t, 0)::numeric END,
         CASE WHEN _visible THEN (COALESCE(v.t, 0) - COALESCE(d.t, 0))::numeric END
  FROM emps e
  LEFT JOIN v ON v.emp IS NOT DISTINCT FROM e.emp
  LEFT JOIN d ON d.emp IS NOT DISTINCT FROM e.emp
  ORDER BY COALESCE(v.c, 0) DESC, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.get_register_seller_summary(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_register_seller_summary(uuid, uuid[]) TO authenticated, service_role;

-- 7. Informe de ventas: las mixtas, repartidas por forma de pago -----------------------------
CREATE OR REPLACE FUNCTION public.get_sales_report(_business_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tz text;
  _pf date;
  _pt date;
  _result jsonb;
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede ver los informes' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Periodo no válido' USING ERRCODE = '22023';
  END IF;
  IF _to - _from > 400 THEN
    RAISE EXCEPTION 'El periodo no puede pasar de 400 días' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(b.timezone, ''), 'Europe/Madrid') INTO _tz FROM businesses b WHERE b.id = _business_id;
  BEGIN
    PERFORM now() AT TIME ZONE _tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    _tz := 'Europe/Madrid';
  END;

  -- Mismo periodo un año antes (el 29 de febrero cae en el 28).
  _pf := (_from - interval '1 year')::date;
  _pt := (_to - interval '1 year')::date;

  WITH rng AS (
    SELECT 'cur'::text AS per, _from::timestamp AT TIME ZONE _tz AS a, (_to + 1)::timestamp AT TIME ZONE _tz AS b
    UNION ALL
    SELECT 'prev', _pf::timestamp AT TIME ZONE _tz, (_pt + 1)::timestamp AT TIME ZONE _tz
  ),
  lines AS (
    -- Ventas de PYMOVA
    SELECT r.per, 'pymova'::text AS src, (s.created_at AT TIME ZONE _tz)::date AS d, 'sale'::text AS kind,
           s.total::numeric AS amount, COALESCE(s.seller_employee_id::text, 'none') AS seller_key,
           COALESCE(s.payment_method, 'other')::text AS pay, COALESCE(s.voucher_amount, 0)::numeric AS voucher,
           s.id AS sid
    FROM rng r JOIN sales s ON s.business_id = _business_id AND s.created_at >= r.a AND s.created_at < r.b
    UNION ALL
    -- Devoluciones de PYMOVA (a quien las hizo, por la forma en que se reembolsó)
    SELECT r.per, 'pymova', (x.created_at AT TIME ZONE _tz)::date, 'return',
           -x.total::numeric, COALESCE(x.seller_employee_id::text, 'none'),
           COALESCE(x.refund_method, 'other')::text, 0::numeric, NULL::uuid
    FROM rng r JOIN sale_returns x ON x.business_id = _business_id AND x.created_at >= r.a AND x.created_at < r.b
    UNION ALL
    -- Tickets de Stockagile
    SELECT r.per, 'stockagile', (k.sold_at AT TIME ZONE _tz)::date,
           CASE WHEN NOT k.is_return THEN 'sale' WHEN k.total <= 0 THEN 'return' ELSE 'exchange' END,
           k.total::numeric, 'stockagile',
           CASE
             WHEN k.payment_methods IS NULL OR btrim(k.payment_methods) = '' THEN 'none'
             WHEN lower(k.payment_methods) ~ '(metálico|metalico|efectivo|cash)'
              AND lower(k.payment_methods) ~ '(tarjeta|card)' THEN 'cash_card'
             WHEN lower(k.payment_methods) ~ '(metálico|metalico|efectivo|cash)' THEN 'cash'
             WHEN lower(k.payment_methods) ~ '(tarjeta|card)' THEN 'card'
             ELSE 'other'
           END,
           0::numeric, NULL::uuid
    FROM rng r JOIN stockagile_sales k ON k.business_id = _business_id AND NOT k.deleted
      AND k.sold_at >= r.a AND k.sold_at < r.b
  ),
  paylines AS (
    SELECT l.per, l.kind, v.m, v.a
    FROM lines l
    CROSS JOIN LATERAL (VALUES (l.pay, l.amount - l.voucher), ('store_credit', l.voucher)) v(m, a)
    WHERE l.pay <> 'mixed'
      AND ((v.m = l.pay AND (l.voucher = 0 OR v.a > 0)) OR (v.m = 'store_credit' AND l.voucher > 0))
    UNION ALL
    -- Venta mixta (0065): cada forma de pago con su parte; el vale, aparte.
    SELECT l.per, l.kind, sp.method, sp.amount
    FROM lines l JOIN sale_payments sp ON sp.sale_id = l.sid
    WHERE l.pay = 'mixed'
    UNION ALL
    SELECT l.per, l.kind, 'store_credit', l.voucher
    FROM lines l
    WHERE l.pay = 'mixed' AND l.voucher > 0
  ),
  kpi AS (
    SELECT l.per,
           count(*) FILTER (WHERE l.kind = 'sale') AS sales_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'sale'), 0) AS sales_total,
           count(*) FILTER (WHERE l.kind = 'return') AS returns_count,
           -COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'return'), 0) AS returns_total,
           count(*) FILTER (WHERE l.kind = 'exchange') AS exchanges_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'exchange'), 0) AS exchanges_total,
           COALESCE(sum(l.amount), 0) AS net_total
    FROM lines l GROUP BY l.per
  ),
  kpi_src AS (
    SELECT l.per, l.src,
           count(*) FILTER (WHERE l.kind = 'sale') AS sales_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'sale'), 0) AS sales_total,
           COALESCE(sum(l.amount), 0) AS net_total
    FROM lines l GROUP BY l.per, l.src
  ),
  pay AS (
    SELECT p.m,
           count(*) FILTER (WHERE p.per = 'cur' AND p.kind = 'sale') AS cur_count,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'cur' AND p.kind = 'sale'), 0) AS cur_sales,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE p.per = 'prev' AND p.kind = 'sale') AS prev_count,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'prev' AND p.kind = 'sale'), 0) AS prev_sales,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'prev'), 0) AS prev_net
    FROM paylines p GROUP BY p.m
  ),
  sel AS (
    SELECT l.seller_key,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale') AS cur_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale'), 0) AS cur_sales,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale') AS prev_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale'), 0) AS prev_sales,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev'), 0) AS prev_net
    FROM lines l GROUP BY l.seller_key
  ),
  dayagg AS (
    SELECT CASE WHEN l.per = 'cur' THEN l.d ELSE (l.d + interval '1 year')::date END AS d,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale') AS cur_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale') AS prev_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev'), 0) AS prev_net
    FROM lines l GROUP BY 1
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to),
    'previous', jsonb_build_object('from', _pf, 'to', _pt),
    'current', COALESCE((SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'cur'),
      jsonb_build_object('sales_count', 0, 'sales_total', 0, 'returns_count', 0, 'returns_total', 0,
                         'exchanges_count', 0, 'exchanges_total', 0, 'net_total', 0)),
    'prior', COALESCE((SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'prev'),
      jsonb_build_object('sales_count', 0, 'sales_total', 0, 'returns_count', 0, 'returns_total', 0,
                         'exchanges_count', 0, 'exchanges_total', 0, 'net_total', 0)),
    'by_source', COALESCE((
      SELECT jsonb_agg(to_jsonb(k) ORDER BY k.src, k.per) FROM kpi_src k), '[]'::jsonb),
    'by_payment', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.cur_net DESC, p.prev_net DESC, p.m) FROM pay p), '[]'::jsonb),
    'by_seller', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'seller_key', s.seller_key,
        'name', CASE s.seller_key
                  WHEN 'none' THEN 'Sin vendedor'
                  WHEN 'stockagile' THEN 'Stockagile (sin vendedor)'
                  ELSE public.employee_display_name(s.seller_key::uuid) END,
        'cur_count', s.cur_count, 'cur_sales', s.cur_sales, 'cur_net', s.cur_net,
        'prev_count', s.prev_count, 'prev_sales', s.prev_sales, 'prev_net', s.prev_net)
        ORDER BY s.cur_net DESC, s.prev_net DESC, s.seller_key)
      FROM sel s), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', g.d::date, 'cur_count', COALESCE(a.cur_count, 0), 'cur_net', COALESCE(a.cur_net, 0),
        'prev_count', COALESCE(a.prev_count, 0), 'prev_net', COALESCE(a.prev_net, 0)) ORDER BY g.d)
      FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(d)
      LEFT JOIN dayagg a ON a.d = g.d::date), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report(uuid, date, date) TO authenticated, service_role;
