-- «Varios» en el TPV: una línea libre, sin producto del catálogo, con la descripción y el
-- precio (IVA incluido) que escribe quien vende. Para outlet o artículos que no están dados
-- de alta. El descuento sigue las mismas reglas y el mismo máximo por persona que el resto.
--
-- La línea se guarda sin producto ni variante: no descuenta ni repone stock, no va a la
-- cola de stock de Shopify ni a Stockagile, y el pedido a Shopify la manda como línea suelta
-- con su título. El nombre lleva delante «Varios · » para reconocerla en tickets e informes.

-- 1. Venta: acepta líneas libres (cuerpo de la 0030 más la rama «Varios») ------------------
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
  _custom boolean;
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

-- 2. Cola de stock a Shopify: nada que enviar sin producto ni variante ----------------------
CREATE OR REPLACE FUNCTION public.enqueue_shopify_inventory_push(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _delta integer,
  _reason text,
  _source_table text,
  _source_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _delta = 0 OR _business_id IS NULL THEN RETURN; END IF;
  IF _product_id IS NULL AND _variant_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shopify_connections
    WHERE business_id = _business_id AND stock_push_enabled = true
  ) THEN
    RETURN;
  END IF;

  INSERT INTO shopify_inventory_pushes (
    business_id, local_product_id, local_variant_id, delta, reason, source_table, source_id
  ) VALUES (
    _business_id, _product_id, _variant_id, _delta, _reason, _source_table, _source_id
  );
END;
$$;

-- 3. Devoluciones a Stockagile: las líneas de Varios no tienen artículo que reponer ---------
CREATE OR REPLACE FUNCTION public.queue_stockagile_move_on_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
  _restock boolean;
BEGIN
  SELECT r.business_id, r.restock INTO _business_id, _restock
  FROM sale_returns r WHERE r.id = NEW.return_id;

  IF NOT COALESCE(_restock, true) OR COALESCE(NEW.quantity, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL AND NEW.variant_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM stockagile_connections c WHERE c.business_id = _business_id AND c.enabled
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO stockagile_stock_moves (
    business_id, local_product_id, local_variant_id, quantity, reason, source_table, source_id
  ) VALUES (
    _business_id, NEW.product_id, NEW.variant_id, NEW.quantity::integer, 'return', 'sale_return_items', NEW.id
  )
  ON CONFLICT (source_table, source_id) DO NOTHING;
  RETURN NEW;
END;
$$;
