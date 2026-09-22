ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit_cost numeric;
ALTER TABLE public.sale_return_items ADD COLUMN IF NOT EXISTS unit_cost numeric;

COMMENT ON COLUMN public.sale_items.unit_cost IS 'Coste unitario congelado en el momento de la venta (para margen histórico y POAS)';
COMMENT ON COLUMN public.sale_return_items.unit_cost IS 'Coste unitario congelado copiado de la línea de venta original';

CREATE OR REPLACE FUNCTION public.create_sale_with_items(_business_id uuid, _items jsonb, _payment_method text DEFAULT 'cash'::text, _client_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text, _subtotal numeric DEFAULT 0, _tax numeric DEFAULT 0, _total numeric DEFAULT 0, _discount numeric DEFAULT 0, _tip numeric DEFAULT 0, _cash_received numeric DEFAULT NULL::numeric, _change_given numeric DEFAULT NULL::numeric, _register_session_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sale_id uuid, sale_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id uuid;
  _number text;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas en este negocio';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos una línea';
  END IF;

  _number := generate_sale_number(_business_id);

  INSERT INTO sales (
    business_id, sale_number, client_id, subtotal, tax, total,
    discount, tip, cash_received, change_given, register_session_id,
    payment_method, notes, created_by
  ) VALUES (
    _business_id, _number, _client_id, _subtotal, _tax, _total,
    COALESCE(_discount, 0), COALESCE(_tip, 0), _cash_received, _change_given,
    _register_session_id, _payment_method, _notes, auth.uid()
  )
  RETURNING id INTO _sale_id;

  INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, quantity, unit_price, discount, total, unit_cost)
  SELECT
    _sale_id,
    line.product_id,
    line.variant_id,
    line.product_name,
    line.quantity,
    line.unit_price,
    line.discount,
    line.total,
    COALESCE(pv.cost_price, p.cost_price)
  FROM (
    SELECT
      NULLIF(NULLIF(item->>'product_id', ''), 'null')::uuid AS product_id,
      NULLIF(NULLIF(item->>'variant_id', ''), 'null')::uuid AS variant_id,
      COALESCE(item->>'product_name', 'Producto') AS product_name,
      COALESCE((item->>'quantity')::numeric, 1) AS quantity,
      COALESCE((item->>'unit_price')::numeric, 0) AS unit_price,
      COALESCE((item->>'discount')::numeric, 0) AS discount,
      COALESCE((item->>'total')::numeric, 0) AS total
    FROM jsonb_array_elements(_items) AS item
  ) AS line
  LEFT JOIN product_variants pv ON pv.id = line.variant_id AND pv.business_id = _business_id
  LEFT JOIN products p ON p.id = line.product_id AND p.business_id = _business_id;

  RETURN QUERY SELECT _sale_id, _number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sale_return(_business_id uuid, _sale_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method text DEFAULT NULL::text, _restock boolean DEFAULT true)
 RETURNS TABLE(return_id uuid, return_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _return_id uuid;
  _number text;
  _next integer;
  _item jsonb;
  _sale_item sale_items%ROWTYPE;
  _qty numeric;
  _already numeric;
  _total numeric := 0;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = _sale_id AND business_id = _business_id) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
  END IF;

  SELECT COALESCE(MAX(CASE WHEN return_number ~ '^DEV-[0-9]+$'
       THEN SUBSTRING(return_number FROM 5)::integer ELSE 0 END), 0) + 1
  INTO _next FROM sale_returns WHERE business_id = _business_id;

  _number := 'DEV-' || LPAD(_next::text, 6, '0');

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _qty := COALESCE((_item->>'quantity')::numeric, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _sale_item
    FROM sale_items
    WHERE id = (_item->>'sale_item_id')::uuid AND sale_id = _sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Línea de venta no encontrada';
    END IF;

    SELECT COALESCE(SUM(ri.quantity), 0) INTO _already
    FROM sale_return_items ri
    JOIN sale_returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = _sale_item.id AND r.id <> _return_id;

    IF _already + _qty > _sale_item.quantity THEN
      RAISE EXCEPTION 'No puedes devolver más unidades de "%" de las vendidas (% pendientes)',
        _sale_item.product_name, _sale_item.quantity - _already;
    END IF;

    INSERT INTO sale_return_items (
      return_id, sale_item_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost
    ) VALUES (
      _return_id, _sale_item.id, _sale_item.product_id, _sale_item.variant_id,
      _sale_item.product_name, _qty, _sale_item.unit_price,
      ROUND(_qty * _sale_item.unit_price, 2), _sale_item.unit_cost
    );

    _total := _total + ROUND(_qty * _sale_item.unit_price, 2);

    IF COALESCE(_restock, true) THEN
      IF _sale_item.variant_id IS NOT NULL THEN
        UPDATE product_variants
        SET stock_quantity = stock_quantity + _qty::integer, updated_at = now()
        WHERE id = _sale_item.variant_id;
      ELSIF _sale_item.product_id IS NOT NULL THEN
        UPDATE products
        SET stock_quantity = COALESCE(stock_quantity, 0) + _qty::integer
        WHERE id = _sale_item.product_id AND track_inventory = true;
      END IF;
    END IF;
  END LOOP;

  UPDATE sale_returns SET total = _total WHERE id = _return_id;

  RETURN QUERY SELECT _return_id, _number;
END;
$function$;