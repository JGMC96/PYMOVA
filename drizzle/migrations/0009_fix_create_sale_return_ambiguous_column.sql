CREATE OR REPLACE FUNCTION public.create_sale_return(_business_id uuid, _sale_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method text DEFAULT NULL::text, _restock boolean DEFAULT true)
 RETURNS TABLE(return_id uuid, return_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
  IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = _sale_id AND s.business_id = _business_id) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
  END IF;

  SELECT COALESCE(MAX(CASE WHEN sr.return_number ~ '^DEV-[0-9]+$'
       THEN SUBSTRING(sr.return_number FROM 5)::integer ELSE 0 END), 0) + 1
  INTO _next FROM sale_returns sr WHERE sr.business_id = _business_id;

  _number := 'DEV-' || LPAD(_next::text, 6, '0');

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid())
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
$function$;