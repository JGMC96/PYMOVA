-- A11 · IVA incluido en el precio (docs/AUDITORIA.md).
-- El precio del catálogo es el precio final que paga el cliente. El total de la
-- venta o la factura es la suma de las líneas; la base imponible y la cuota se
-- deducen de él. Tipo por defecto: 21 %.
-- No se tocan filas existentes. Migración idempotente.

ALTER TABLE public.business_settings ALTER COLUMN tax_rate SET DEFAULT 21;

-- 1. Venta del TPV (cuerpo de la 0017; solo cambia el bloque de totales) --------
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

-- 2. Factura (misma firma; los precios de línea incluyen el IVA) -----------------
CREATE OR REPLACE FUNCTION public.create_invoice_with_items(
  _business_id uuid,
  _client_id uuid,
  _items jsonb,
  _due_date date DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS TABLE(invoice_id uuid, invoice_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invoice_number text;
  _invoice_id uuid;
  _tax_rate numeric;
  _subtotal numeric;
  _tax numeric;
  _total numeric := 0;
  _item jsonb;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para crear facturas en este negocio' USING ERRCODE = '42501';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La factura debe tener al menos una línea' USING ERRCODE = '22023';
  END IF;

  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients
    WHERE id = _client_id AND business_id = _business_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(bs.tax_rate, 21) INTO _tax_rate FROM business_settings bs WHERE bs.business_id = _business_id;
  IF NOT FOUND THEN _tax_rate := 21; END IF;

  -- Numeración correlativa (contador con bloqueo, dz/0018)
  _invoice_number := generate_invoice_number(_business_id);

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _total := _total + ROUND(COALESCE((_item->>'quantity')::numeric, 0) * COALESCE((_item->>'unit_price')::numeric, 0), 2);
  END LOOP;

  -- IVA incluido: el total es la suma de las líneas; base y cuota se deducen de él.
  _total := ROUND(_total, 2);
  _subtotal := ROUND(_total / (1 + _tax_rate / 100), 2);
  _tax := ROUND(_total - _subtotal, 2);

  INSERT INTO invoices (
    business_id, client_id, invoice_number, status, subtotal, tax, total, due_date, notes, created_by
  ) VALUES (
    _business_id, _client_id, _invoice_number, 'draft', _subtotal, _tax, _total, _due_date, _notes, auth.uid()
  )
  RETURNING id INTO _invoice_id;

  INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, total)
  SELECT
    _invoice_id,
    NULLIF(NULLIF(item->>'product_id', ''), 'null')::uuid,
    COALESCE(item->>'description', ''),
    COALESCE((item->>'quantity')::numeric, 1),
    COALESCE((item->>'unit_price')::numeric, 0),
    ROUND(COALESCE((item->>'quantity')::numeric, 1) * COALESCE((item->>'unit_price')::numeric, 0), 2)
  FROM jsonb_array_elements(_items) AS item;

  RETURN QUERY SELECT _invoice_id, _invoice_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_with_items(uuid, uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_items(uuid, uuid, jsonb, date, text) TO authenticated, service_role;