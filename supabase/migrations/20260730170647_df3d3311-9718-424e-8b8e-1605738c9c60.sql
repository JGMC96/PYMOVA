ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS online_orders_business_source_external_idx
  ON public.online_orders (business_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shopify_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  orders_sync_enabled boolean NOT NULL DEFAULT true,
  webhooks_registered_at timestamptz,
  last_orders_sync_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_domain)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_connections TO authenticated;
GRANT ALL ON public.shopify_connections TO service_role;
ALTER TABLE public.shopify_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view shopify connections"
  ON public.shopify_connections FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE POLICY "Admins can insert shopify connections"
  ON public.shopify_connections FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can update shopify connections"
  ON public.shopify_connections FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can delete shopify connections"
  ON public.shopify_connections FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE TRIGGER update_shopify_connections_updated_at
  BEFORE UPDATE ON public.shopify_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.integration_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  topic text NOT NULL,
  external_id text,
  event_id text,
  status text NOT NULL DEFAULT 'processed',
  message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_webhook_events_unique_event_idx
  ON public.integration_webhook_events (integration_key, event_id)
  WHERE event_id IS NOT NULL;

GRANT SELECT ON public.integration_webhook_events TO authenticated;
GRANT ALL ON public.integration_webhook_events TO service_role;
ALTER TABLE public.integration_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook events"
  ON public.integration_webhook_events FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND (public.has_min_role(business_id, 'admin') OR public.is_super_admin()));

CREATE OR REPLACE FUNCTION public.upsert_external_order(
  _business_id uuid,
  _source text,
  _external_id text,
  _order_number text,
  _customer_name text,
  _customer_email text,
  _customer_phone text,
  _shipping_address text,
  _status online_order_status,
  _payment_status text,
  _payment_method text,
  _subtotal numeric,
  _shipping_cost numeric,
  _tax numeric,
  _discount numeric,
  _total numeric,
  _tracking_number text,
  _notes text,
  _items jsonb,
  _external_updated_at timestamptz
) RETURNS TABLE(order_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    DELETE FROM public.online_order_items WHERE order_id = _id;
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
$$;

REVOKE ALL ON FUNCTION public.upsert_external_order(uuid, text, text, text, text, text, text, text, online_order_status, text, text, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_external_order(uuid, text, text, text, text, text, text, text, online_order_status, text, text, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, timestamptz) TO service_role;