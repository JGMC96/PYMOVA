-- TPV: ventas, tickets y devoluciones solo por RPC (A1, A2, A3 y M1 de docs/AUDITORIA.md).
-- - create_sale_with_items valida que cliente, caja, productos y variantes sean
--   del negocio, toma el precio del catálogo y recalcula descuento, IVA y total.
-- - decrement_stock_on_sale comprueba el negocio (defensa en profundidad).
-- - sales, sale_items, sale_returns y sale_return_items: sin escritura directa
--   desde el cliente; solo el super admin puede borrar, y queda auditado.
-- Migración idempotente.

-- 1. Venta atómica con importes calculados en el servidor ----------------------
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
  _subtotal_calc numeric := 0;
  _discount_calc numeric := 0;
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
  END IF;

  IF COALESCE(_tip, 0) < 0 THEN
    RAISE EXCEPTION 'La propina no puede ser negativa' USING ERRCODE = '22023';
  END IF;

  -- Mismo tipo de IVA que usa el TPV (business_settings.tax_rate, 16 si no hay fila)
  SELECT COALESCE(bs.tax_rate, 16) INTO _tax_rate FROM business_settings bs WHERE bs.business_id = _business_id;
  IF NOT FOUND THEN _tax_rate := 16; END IF;

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

    -- Precio del catálogo; el total de la línea que manda el TPV es el neto (bruto − descuento).
    _gross := ROUND(_qty * COALESCE(_price, 0), 2);
    _net := ROUND(COALESCE((_item->>'total')::numeric, _gross), 2);
    _line_discount := ROUND(_gross - _net, 2);
    IF _line_discount < 0 OR _line_discount > _gross THEN
      RAISE EXCEPTION 'El descuento de "%" no cuadra: bruto %, neto %', COALESCE(_line_name, _catalog_name), _gross, _net USING ERRCODE = '22023';
    END IF;

    _subtotal_calc := _subtotal_calc + _net;
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

  _tax_calc := ROUND(_subtotal_calc * _tax_rate / 100, 2);
  _total_calc := ROUND(_subtotal_calc + _tax_calc, 2);

  IF abs(_subtotal_calc - COALESCE(_subtotal, 0)) > 0.02
     OR abs(_discount_calc - COALESCE(_discount, 0)) > 0.02
     OR abs(_tax_calc - COALESCE(_tax, 0)) > 0.02
     OR abs(_total_calc - COALESCE(_total, 0)) > 0.02 THEN
    RAISE EXCEPTION 'Los importes no cuadran. Calculado: subtotal %, descuento %, IVA %, total %. Recibido: %, %, %, %',
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

-- 2. Trigger de stock: la línea tiene que ser del negocio de la venta ----------
CREATE OR REPLACE FUNCTION public.decrement_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sale_business uuid;
  _line_business uuid;
  _current integer;
  _track boolean;
  _name text;
BEGIN
  SELECT business_id INTO _sale_business FROM sales WHERE id = NEW.sale_id;

  IF NEW.variant_id IS NOT NULL THEN
    SELECT stock_quantity, name, business_id INTO _current, _name, _line_business
    FROM product_variants WHERE id = NEW.variant_id FOR UPDATE;
    IF NOT FOUND OR _line_business IS DISTINCT FROM _sale_business THEN
      RAISE EXCEPTION 'La variante no pertenece al negocio de la venta' USING ERRCODE = '42501';
    END IF;
    IF _current IS NOT NULL AND _current < NEW.quantity::integer THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": quedan % unidades', COALESCE(_name, 'variante'), _current;
    END IF;
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity::integer,
        updated_at = now()
    WHERE id = NEW.variant_id;

  ELSIF NEW.product_id IS NOT NULL THEN
    SELECT stock_quantity, name, business_id, track_inventory INTO _current, _name, _line_business, _track
    FROM products WHERE id = NEW.product_id FOR UPDATE;
    IF NOT FOUND OR _line_business IS DISTINCT FROM _sale_business THEN
      RAISE EXCEPTION 'El producto no pertenece al negocio de la venta' USING ERRCODE = '42501';
    END IF;
    IF _track THEN
      IF COALESCE(_current, 0) < NEW.quantity::integer THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": quedan % unidades', COALESCE(_name, 'producto'), COALESCE(_current, 0);
      END IF;
      UPDATE products
      SET stock_quantity = COALESCE(stock_quantity, 0) - NEW.quantity::integer
      WHERE id = NEW.product_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Tickets inalterables desde el cliente ------------------------------------
DROP POLICY IF EXISTS "Members can manage sale items" ON public.sale_items;
DROP POLICY IF EXISTS "Super admins can manage all sale items" ON public.sale_items;
DROP POLICY IF EXISTS "Super admins can view all sale items" ON public.sale_items;
CREATE POLICY "Super admins can view all sale items"
ON public.sale_items FOR SELECT
TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Members can create sales" ON public.sales;
DROP POLICY IF EXISTS "Owner/Admin can delete sales" ON public.sales;

DROP TRIGGER IF EXISTS trg_audit_sales ON public.sales;
CREATE TRIGGER trg_audit_sales
AFTER DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();

-- 4. Devoluciones solo por create_sale_return ---------------------------------
DROP POLICY IF EXISTS "Members create returns" ON public.sale_returns;
DROP POLICY IF EXISTS "Admins delete returns" ON public.sale_returns;
DROP POLICY IF EXISTS "Super admins delete returns" ON public.sale_returns;
CREATE POLICY "Super admins delete returns"
ON public.sale_returns FOR DELETE
TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Members create return items" ON public.sale_return_items;
DROP POLICY IF EXISTS "Admins delete return items" ON public.sale_return_items;
DROP POLICY IF EXISTS "Super admins delete return items" ON public.sale_return_items;
CREATE POLICY "Super admins delete return items"
ON public.sale_return_items FOR DELETE
TO authenticated
USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_audit_sale_returns ON public.sale_returns;
CREATE TRIGGER trg_audit_sale_returns
AFTER DELETE ON public.sale_returns
FOR EACH ROW EXECUTE FUNCTION public.audit_security_changes();
