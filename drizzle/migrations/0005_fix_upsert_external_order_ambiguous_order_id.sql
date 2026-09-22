CREATE OR REPLACE FUNCTION public.upsert_external_order(_business_id uuid, _source text, _external_id text, _order_number text, _customer_name text, _customer_email text, _customer_phone text, _shipping_address text, _status online_order_status, _payment_status text, _payment_method text, _subtotal numeric, _shipping_cost numeric, _tax numeric, _discount numeric, _total numeric, _tracking_number text, _notes text, _items jsonb, _external_updated_at timestamp with time zone)
 RETURNS TABLE(order_id uuid, was_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _created boolean := false;
  _item jsonb;
  _existing record;
BEGIN
  SELECT * INTO _existing
  FROM public.online_orders
  WHERE business_id = _business_id AND source = _source AND external_id = _external_id
  FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.online_orders(
      business_id, order_number, external_id, source, customer_name, customer_email, customer_phone,
      shipping_address, status, payment_status, payment_method, subtotal, shipping_cost, tax,
      discount, total, tracking_number, notes, external_updated_at, external_synced_at)
    VALUES (
      _business_id, _order_number, _external_id, _source, _customer_name, _customer_email, _customer_phone,
      _shipping_address, COALESCE(_status, 'pending'), COALESCE(_payment_status, 'pending'), _payment_method,
      COALESCE(_subtotal, 0), COALESCE(_shipping_cost, 0), COALESCE(_tax, 0), COALESCE(_discount, 0),
      COALESCE(_total, 0), _tracking_number, _notes, _external_updated_at, now())
    RETURNING id INTO _id;
    _created := true;
  ELSE
    _id := _existing.id;
    UPDATE public.online_orders SET
      customer_name = COALESCE(_customer_name, customer_name),
      customer_email = COALESCE(_customer_email, customer_email),
      customer_phone = COALESCE(_customer_phone, customer_phone),
      shipping_address = COALESCE(_shipping_address, shipping_address),
      payment_status = COALESCE(_payment_status, payment_status),
      payment_method = COALESCE(_payment_method, payment_method),
      subtotal = COALESCE(_subtotal, subtotal),
      shipping_cost = COALESCE(_shipping_cost, shipping_cost),
      tax = COALESCE(_tax, tax),
      discount = COALESCE(_discount, discount),
      total = COALESCE(_total, total),
      tracking_number = COALESCE(_tracking_number, tracking_number),
      notes = COALESCE(_notes, notes),
      status = CASE
        WHEN _status IN ('cancelled', 'returned') THEN _status
        WHEN status IN ('cancelled', 'returned') THEN status
        ELSE COALESCE(_status, status)
      END,
      external_updated_at = COALESCE(_external_updated_at, external_updated_at),
      external_synced_at = now(),
      updated_at = now()
    WHERE id = _id;
  END IF;

  IF _items IS NOT NULL AND jsonb_typeof(_items) = 'array' AND jsonb_array_length(_items) > 0 THEN
    -- Cualificado para evitar ambigüedad con el parámetro de salida order_id.
    DELETE FROM public.online_order_items oi WHERE oi.order_id = _id;
    FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      INSERT INTO public.online_order_items(order_id, product_id, variant_id, product_name, quantity, unit_price, total)
      VALUES (
        _id,
        NULLIF(_item->>'product_id', '')::uuid,
        NULLIF(_item->>'variant_id', '')::uuid,
        _item->>'product_name',
        COALESCE((_item->>'quantity')::numeric, 1),
        COALESCE((_item->>'unit_price')::numeric, 0),
        COALESCE((_item->>'total')::numeric, 0));
    END LOOP;
  END IF;

  RETURN QUERY SELECT _id, _created;
END;
$function$;