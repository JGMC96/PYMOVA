-- M2 · Caja y arqueo (docs/AUDITORIA.md).
-- - cash_register_sessions solo se abre y se cierra por RPC; auditoría de aperturas y cierres.
-- - Las devoluciones guardan la caja en la que se devolvió el dinero.
-- - El arqueo resta las devoluciones en efectivo; cualquier miembro puede cerrar la caja.
-- - Cobrar o devolver en efectivo exige una caja abierta; las ventas se asocian solas a ella.
-- - Una devolución vale lo que se cobró en la línea (con su descuento), no el precio de catálogo.
-- Migración idempotente.

-- 1. Permisos de la caja --------------------------------------------------------
DROP POLICY IF EXISTS "register_insert_members" ON public.cash_register_sessions;
DROP POLICY IF EXISTS "register_update_admins" ON public.cash_register_sessions;

REVOKE ALL ON public.cash_register_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.cash_register_sessions FROM authenticated;
GRANT SELECT ON public.cash_register_sessions TO authenticated;

DROP TRIGGER IF EXISTS trg_cash_register_sessions_audit ON public.cash_register_sessions;
CREATE TRIGGER trg_cash_register_sessions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.cash_register_sessions
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- 2. Devoluciones con caja -------------------------------------------------------
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS register_session_id uuid REFERENCES public.cash_register_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sale_returns_register_session_idx ON public.sale_returns (register_session_id);

-- Devoluciones en efectivo hechas con una caja del negocio abierta: se asocian a ella.
UPDATE public.sale_returns r
SET register_session_id = c.id
FROM public.cash_register_sessions c
WHERE r.register_session_id IS NULL
  AND r.refund_method = 'cash'
  AND c.business_id = r.business_id
  AND r.created_at >= c.opened_at
  AND (c.closed_at IS NULL OR r.created_at < c.closed_at);

-- 3. Abrir caja ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_register_session(_business_id uuid, _opening_amount numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para abrir caja en este negocio' USING ERRCODE = '42501';
  END IF;

  -- Una apertura a la vez por negocio.
  PERFORM pg_advisory_xact_lock(hashtextextended('open_register_session:' || _business_id::text, 0));

  IF EXISTS (SELECT 1 FROM cash_register_sessions WHERE business_id = _business_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una caja abierta' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(_opening_amount, 0) < 0 THEN
    RAISE EXCEPTION 'El fondo de caja no puede ser negativo' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO cash_register_sessions (business_id, opening_amount, opened_by)
    VALUES (_business_id, ROUND(COALESCE(_opening_amount, 0), 2), auth.uid())
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay una caja abierta' USING ERRCODE = '22023';
  END;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_register_session(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_register_session(uuid, numeric) TO authenticated, service_role;

-- 4. Cerrar caja (cualquier miembro; resta las devoluciones en efectivo) ---------
CREATE OR REPLACE FUNCTION public.close_register_session(_session_id uuid, _counted_amount numeric, _notes text DEFAULT NULL)
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
      counted_amount = ROUND(_counted_amount, 2),
      expected_amount = _expected,
      difference = ROUND(_counted_amount, 2) - _expected,
      notes = _notes,
      updated_at = now()
  WHERE id = _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_register_session(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_register_session(uuid, numeric, text) TO authenticated, service_role;

-- 5. Resumen de la caja (añade devoluciones por método) --------------------------
DROP FUNCTION IF EXISTS public.get_register_summary(uuid);

CREATE FUNCTION public.get_register_summary(_session_id uuid)
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
BEGIN
  SELECT c.business_id INTO _business_id FROM cash_register_sessions c WHERE c.id = _session_id;
  IF _business_id IS NULL OR NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esta caja' USING ERRCODE = '42501';
  END IF;

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
         COALESCE(v.t, 0)::numeric,
         COALESCE(d.c, 0)::bigint,
         COALESCE(d.t, 0)::numeric
  FROM v FULL JOIN d ON d.m = v.m
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_register_summary(uuid) TO authenticated, service_role;

-- 6. Venta del TPV (cuerpo de la 0019; solo cambia la caja) -----------------------
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
  _register_session_id uuid DEFAULT NULL
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
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas en este negocio' USING ERRCODE = '42501';
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
    payment_method, notes, created_by
  ) VALUES (
    _business_id, _number, _client_id, _subtotal_calc, _tax_calc, _total_calc,
    _discount_calc, COALESCE(_tip, 0), _cash_received, _change_given,
    _register_session_id, _payment_method, _notes, auth.uid()
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

REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) TO authenticated, service_role;

-- 7. Devolución (cuerpo de la 0018: caja, método e importe neto) ------------------
CREATE OR REPLACE FUNCTION public.create_sale_return(
  _business_id uuid,
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL,
  _restock boolean DEFAULT true
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
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = _sale_id AND s.business_id = _business_id) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
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

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by, register_session_id)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid(), _register_id)
  RETURNING id INTO _return_id;
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
    SELECT COALESCE(SUM(ri.quantity), 0) INTO _already
    FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = _sale_item.id AND r.id <> _return_id;
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
  UPDATE sale_returns sr SET total = _total WHERE sr.id = _return_id;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) TO authenticated, service_role;
