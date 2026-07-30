
CREATE TYPE public.online_order_status AS ENUM ('pending','accepted','preparing','shipped','delivered','cancelled','returned');

CREATE TABLE public.online_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  external_id text,
  source text NOT NULL DEFAULT 'manual',
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  shipping_address text,
  status public.online_order_status NOT NULL DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'pending',
  payment_method text,
  subtotal numeric NOT NULL DEFAULT 0,
  shipping_cost numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  tracking_number text,
  notes text,
  stock_applied boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, order_number)
);

CREATE TABLE public.online_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.online_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  kind text NOT NULL DEFAULT 'return',
  reason text,
  refund_method text,
  total numeric NOT NULL DEFAULT 0,
  restock boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by uuid
);

CREATE INDEX idx_online_orders_business ON public.online_orders(business_id, created_at DESC);
CREATE INDEX idx_online_order_items_order ON public.online_order_items(order_id);
CREATE INDEX idx_sync_runs_business ON public.integration_sync_runs(business_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_orders TO authenticated;
GRANT ALL ON public.online_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_order_items TO authenticated;
GRANT ALL ON public.online_order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_order_returns TO authenticated;
GRANT ALL ON public.online_order_returns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_sync_runs TO authenticated;
GRANT ALL ON public.integration_sync_runs TO service_role;

ALTER TABLE public.online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_view_online_orders" ON public.online_orders FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());
CREATE POLICY "staff_create_online_orders" ON public.online_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'staff') OR public.is_super_admin());
CREATE POLICY "staff_update_online_orders" ON public.online_orders FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'staff') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'staff') OR public.is_super_admin());
CREATE POLICY "admins_delete_online_orders" ON public.online_orders FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "members_view_online_order_items" ON public.online_order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id AND (public.is_member_of_business(o.business_id) OR public.is_super_admin())));
CREATE POLICY "staff_write_online_order_items" ON public.online_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id AND (public.has_min_role(o.business_id,'staff') OR public.is_super_admin())));
CREATE POLICY "staff_update_online_order_items" ON public.online_order_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id AND (public.has_min_role(o.business_id,'staff') OR public.is_super_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id AND (public.has_min_role(o.business_id,'staff') OR public.is_super_admin())));
CREATE POLICY "admins_delete_online_order_items" ON public.online_order_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id AND (public.has_min_role(o.business_id,'admin') OR public.is_super_admin())));

CREATE POLICY "members_view_online_returns" ON public.online_order_returns FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());
CREATE POLICY "staff_create_online_returns" ON public.online_order_returns FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'staff') OR public.is_super_admin());
CREATE POLICY "admins_delete_online_returns" ON public.online_order_returns FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "members_view_sync_runs" ON public.integration_sync_runs FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());
CREATE POLICY "staff_create_sync_runs" ON public.integration_sync_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'staff') OR public.is_super_admin());
CREATE POLICY "staff_update_sync_runs" ON public.integration_sync_runs FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'staff') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'staff') OR public.is_super_admin());
CREATE POLICY "admins_delete_sync_runs" ON public.integration_sync_runs FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE TRIGGER update_online_orders_updated_at BEFORE UPDATE ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.generate_online_order_number(_business_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '\D', '', 'g'), '')::integer), 0) + 1
    INTO _n FROM public.online_orders WHERE business_id = _business_id;
  RETURN 'WEB-' || LPAD(_n::text, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.create_online_order(
  _business_id uuid, _items jsonb, _customer_name text, _customer_email text DEFAULT NULL,
  _customer_phone text DEFAULT NULL, _shipping_address text DEFAULT NULL,
  _shipping_cost numeric DEFAULT 0, _tax numeric DEFAULT 0, _discount numeric DEFAULT 0,
  _payment_method text DEFAULT NULL, _payment_status text DEFAULT 'pending',
  _source text DEFAULT 'manual', _client_id uuid DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS TABLE(order_id uuid, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _num text; _item jsonb; _subtotal numeric := 0;
BEGIN
  IF NOT (public.has_min_role(_business_id, 'staff') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permisos para crear pedidos en este negocio';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _subtotal := _subtotal + (_item->>'total')::numeric;
  END LOOP;

  _num := public.generate_online_order_number(_business_id);

  INSERT INTO public.online_orders(
    business_id, order_number, source, client_id, customer_name, customer_email, customer_phone,
    shipping_address, payment_method, payment_status, subtotal, shipping_cost, tax, discount, total, notes, created_by)
  VALUES (_business_id, _num, _source, _client_id, _customer_name, _customer_email, _customer_phone,
    _shipping_address, _payment_method, COALESCE(_payment_status,'pending'), _subtotal,
    COALESCE(_shipping_cost,0), COALESCE(_tax,0), COALESCE(_discount,0),
    _subtotal + COALESCE(_shipping_cost,0) + COALESCE(_tax,0) - COALESCE(_discount,0), _notes, auth.uid())
  RETURNING id INTO _id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.online_order_items(order_id, product_id, variant_id, product_name, quantity, unit_price, total)
    VALUES (_id, NULLIF(_item->>'product_id','')::uuid, NULLIF(_item->>'variant_id','')::uuid,
      _item->>'product_name', (_item->>'quantity')::numeric, (_item->>'unit_price')::numeric, (_item->>'total')::numeric);
  END LOOP;

  RETURN QUERY SELECT _id, _num;
END; $$;

CREATE OR REPLACE FUNCTION public.apply_online_order_stock(_order_id uuid, _direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _it record; _available integer;
BEGIN
  FOR _it IN SELECT * FROM public.online_order_items WHERE order_id = _order_id LOOP
    IF _it.variant_id IS NOT NULL THEN
      IF _direction < 0 THEN
        SELECT stock_quantity INTO _available FROM public.product_variants WHERE id = _it.variant_id FOR UPDATE;
        IF _available IS NOT NULL AND _available < _it.quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para %', _it.product_name;
        END IF;
      END IF;
      UPDATE public.product_variants
        SET stock_quantity = GREATEST(0, stock_quantity + (_direction * _it.quantity)::integer)
        WHERE id = _it.variant_id;
    ELSIF _it.product_id IS NOT NULL THEN
      IF _direction < 0 THEN
        SELECT stock_quantity INTO _available FROM public.products
          WHERE id = _it.product_id AND track_inventory IS TRUE FOR UPDATE;
        IF _available IS NOT NULL AND _available < _it.quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para %', _it.product_name;
        END IF;
      END IF;
      UPDATE public.products
        SET stock_quantity = GREATEST(0, COALESCE(stock_quantity,0) + (_direction * _it.quantity)::integer)
        WHERE id = _it.product_id AND track_inventory IS TRUE;
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.set_online_order_status(_order_id uuid, _status public.online_order_status, _tracking_number text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o record;
BEGIN
  SELECT * INTO _o FROM public.online_orders WHERE id = _order_id FOR UPDATE;
  IF _o IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT (public.has_min_role(_o.business_id, 'staff') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permisos para modificar este pedido';
  END IF;

  IF _status IN ('accepted','preparing','shipped','delivered') AND NOT _o.stock_applied THEN
    PERFORM public.apply_online_order_stock(_order_id, -1);
    UPDATE public.online_orders SET stock_applied = true WHERE id = _order_id;
  ELSIF _status IN ('cancelled','returned') AND _o.stock_applied THEN
    PERFORM public.apply_online_order_stock(_order_id, 1);
    UPDATE public.online_orders SET stock_applied = false WHERE id = _order_id;
  END IF;

  UPDATE public.online_orders
    SET status = _status, tracking_number = COALESCE(_tracking_number, tracking_number)
    WHERE id = _order_id;
END; $$;

CREATE OR REPLACE FUNCTION public.create_online_order_return(
  _order_id uuid, _kind text DEFAULT 'return', _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL, _total numeric DEFAULT 0, _restock boolean DEFAULT true)
RETURNS TABLE(return_id uuid, return_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o record; _id uuid; _num text; _n integer;
BEGIN
  SELECT * INTO _o FROM public.online_orders WHERE id = _order_id FOR UPDATE;
  IF _o IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT (public.has_min_role(_o.business_id, 'staff') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permisos para registrar devoluciones';
  END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(return_number, '\D', '', 'g'), '')::integer), 0) + 1
    INTO _n FROM public.online_order_returns WHERE business_id = _o.business_id;
  _num := 'DEVW-' || LPAD(_n::text, 6, '0');

  INSERT INTO public.online_order_returns(business_id, order_id, return_number, kind, reason, refund_method, total, restock, created_by)
  VALUES (_o.business_id, _order_id, _num, COALESCE(_kind,'return'), _reason, _refund_method, COALESCE(_total,0), COALESCE(_restock,true), auth.uid())
  RETURNING id INTO _id;

  IF COALESCE(_restock, true) AND _o.stock_applied THEN
    PERFORM public.apply_online_order_stock(_order_id, 1);
    UPDATE public.online_orders SET stock_applied = false WHERE id = _order_id;
  END IF;

  UPDATE public.online_orders SET status = 'returned' WHERE id = _order_id;

  RETURN QUERY SELECT _id, _num;
END; $$;

REVOKE ALL ON FUNCTION public.apply_online_order_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_online_order_number(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_online_order(uuid, jsonb, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_online_order_status(uuid, public.online_order_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_online_order_return(uuid, text, text, text, numeric, boolean) TO authenticated;
