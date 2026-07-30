-- 1. Remove duplicate stock trigger
DROP TRIGGER IF EXISTS trigger_decrement_stock ON public.sale_items;

-- 2. Harden stock decrement (prevent negative stock)
CREATE OR REPLACE FUNCTION public.decrement_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current integer;
  _name text;
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    SELECT stock_quantity, name INTO _current, _name
    FROM product_variants WHERE id = NEW.variant_id FOR UPDATE;

    IF _current IS NOT NULL AND _current < NEW.quantity::integer THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": quedan % unidades', COALESCE(_name, 'variante'), _current;
    END IF;

    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity::integer,
        updated_at = now()
    WHERE id = NEW.variant_id;

  ELSIF NEW.product_id IS NOT NULL THEN
    SELECT stock_quantity, name INTO _current, _name
    FROM products WHERE id = NEW.product_id AND track_inventory = true FOR UPDATE;

    IF FOUND THEN
      IF COALESCE(_current, 0) < NEW.quantity::integer THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": quedan % unidades', COALESCE(_name, 'producto'), COALESCE(_current, 0);
      END IF;

      UPDATE products
      SET stock_quantity = COALESCE(stock_quantity, 0) - NEW.quantity::integer
      WHERE id = NEW.product_id AND track_inventory = true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Atomic sale creation
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

  INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, quantity, unit_price, discount, total)
  SELECT
    _sale_id,
    NULLIF(NULLIF(item->>'product_id', ''), 'null')::uuid,
    NULLIF(NULLIF(item->>'variant_id', ''), 'null')::uuid,
    COALESCE(item->>'product_name', 'Producto'),
    COALESCE((item->>'quantity')::numeric, 1),
    COALESCE((item->>'unit_price')::numeric, 0),
    COALESCE((item->>'discount')::numeric, 0),
    COALESCE((item->>'total')::numeric, 0)
  FROM jsonb_array_elements(_items) AS item;

  RETURN QUERY SELECT _sale_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items(uuid, jsonb, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid) TO authenticated, service_role;

-- 4. Returns
CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  reason text,
  refund_method text,
  total numeric NOT NULL DEFAULT 0,
  restock boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.sale_returns(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE SET NULL,
  product_id uuid,
  variant_id uuid,
  product_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON public.sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_business ON public.sale_returns(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON public.sale_return_items(return_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_returns TO authenticated;
GRANT ALL ON public.sale_returns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_return_items TO authenticated;
GRANT ALL ON public.sale_return_items TO service_role;

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view returns" ON public.sale_returns
  FOR SELECT TO authenticated
  USING (is_member_of_business(business_id) OR is_super_admin());

CREATE POLICY "Members create returns" ON public.sale_returns
  FOR INSERT TO authenticated
  WITH CHECK (is_member_of_business(business_id));

CREATE POLICY "Admins delete returns" ON public.sale_returns
  FOR DELETE TO authenticated
  USING (has_min_role(business_id, 'admin') OR is_super_admin());

CREATE POLICY "Members view return items" ON public.sale_return_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sale_returns r
    WHERE r.id = return_id AND (is_member_of_business(r.business_id) OR is_super_admin())
  ));

CREATE POLICY "Members create return items" ON public.sale_return_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sale_returns r
    WHERE r.id = return_id AND is_member_of_business(r.business_id)
  ));

CREATE POLICY "Admins delete return items" ON public.sale_return_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sale_returns r
    WHERE r.id = return_id AND (has_min_role(r.business_id, 'admin') OR is_super_admin())
  ));

-- 5. Return creation RPC (restores stock)
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
      return_id, sale_item_id, product_id, variant_id, product_name, quantity, unit_price, total
    ) VALUES (
      _return_id, _sale_item.id, _sale_item.product_id, _sale_item.variant_id,
      _sale_item.product_name, _qty, _sale_item.unit_price,
      ROUND(_qty * _sale_item.unit_price, 2)
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
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) TO authenticated, service_role;

-- 6. Sale detail with returned quantities
CREATE OR REPLACE FUNCTION public.get_sale_detail(_sale_id uuid)
RETURNS TABLE(
  sale_item_id uuid,
  product_id uuid,
  variant_id uuid,
  product_name text,
  quantity numeric,
  unit_price numeric,
  total numeric,
  returned_quantity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
BEGIN
  SELECT business_id INTO _business_id FROM sales WHERE id = _sale_id;
  IF _business_id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF NOT is_member_of_business(_business_id) AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Sin permiso';
  END IF;

  RETURN QUERY
  SELECT si.id, si.product_id, si.variant_id, si.product_name,
         si.quantity, si.unit_price, si.total,
         COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0)::numeric
  FROM sale_items si
  WHERE si.sale_id = _sale_id
  ORDER BY si.product_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sale_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_detail(uuid) TO authenticated, service_role;