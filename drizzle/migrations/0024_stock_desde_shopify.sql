-- Stock desde Shopify y movimientos de stock (A12, primera parte).
-- Regla: para los artículos emparejados manda Shopify, en la ubicación de la tienda
-- (shopify_connections.default_location_gid). Stock local = disponible en la tienda
-- + envíos a Shopify aún pendientes. Lo que nace en Pymova va a Shopify por la cola;
-- lo que nace en Shopify llega por webhook (apply_shopify_inventory_levels).
-- Todo cambio de stock queda en stock_movements con su origen.
-- Migración idempotente.

-- 1. Historial de movimientos ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  delta integer NOT NULL,
  stock_after integer,
  source text NOT NULL CHECK (source IN ('sale', 'return', 'online_order', 'shopify', 'import', 'manual', 'initial', 'other')),
  reference_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON public.stock_movements (business_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_variant_idx ON public.stock_movements (variant_id, created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read stock movements" ON public.stock_movements;
CREATE POLICY "Members read stock movements" ON public.stock_movements FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id) OR public.is_super_admin());
REVOKE ALL ON public.stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;

-- Origen del cambio: marca de sesión app.stock_source (y app.stock_ref) que ponen las
-- funciones que mueven stock. Sin marca: alta inicial, importación o ajuste manual.
CREATE OR REPLACE FUNCTION public.log_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _delta integer;
  _source text;
  _ref uuid;
  _product uuid;
  _variant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stock_quantity IS NOT DISTINCT FROM OLD.stock_quantity THEN RETURN NULL; END IF;
    _delta := COALESCE(NEW.stock_quantity, 0) - COALESCE(OLD.stock_quantity, 0);
  ELSE
    IF COALESCE(NEW.stock_quantity, 0) = 0 THEN RETURN NULL; END IF;
    _delta := NEW.stock_quantity;
  END IF;

  IF TG_TABLE_NAME = 'product_variants' THEN
    _product := NEW.product_id;
    _variant := NEW.id;
  ELSE
    -- Un producto con variantes vale la suma de ellas: el movimiento ya queda en la variante.
    IF EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = NEW.id) THEN RETURN NULL; END IF;
    _product := NEW.id;
  END IF;

  _source := NULLIF(current_setting('app.stock_source', true), '');
  IF _source IS NULL THEN
    _source := CASE
      WHEN TG_OP = 'INSERT' THEN 'initial'
      WHEN current_setting('role', true) = 'service_role' THEN 'import'
      ELSE 'manual'
    END;
  END IF;
  BEGIN
    _ref := NULLIF(current_setting('app.stock_ref', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    _ref := NULL;
  END;

  INSERT INTO stock_movements (business_id, product_id, variant_id, delta, stock_after, source, reference_id, note, created_by)
  VALUES (NEW.business_id, _product, _variant, _delta, NEW.stock_quantity, _source, _ref,
          NULLIF(current_setting('app.stock_note', true), ''), auth.uid());
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_stock_products_ins ON public.products;
CREATE TRIGGER trg_log_stock_products_ins AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.log_stock_movement();
DROP TRIGGER IF EXISTS trg_log_stock_products_upd ON public.products;
CREATE TRIGGER trg_log_stock_products_upd AFTER UPDATE OF stock_quantity ON public.products
FOR EACH ROW EXECUTE FUNCTION public.log_stock_movement();
DROP TRIGGER IF EXISTS trg_log_stock_variants_ins ON public.product_variants;
CREATE TRIGGER trg_log_stock_variants_ins AFTER INSERT ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.log_stock_movement();
DROP TRIGGER IF EXISTS trg_log_stock_variants_upd ON public.product_variants;
CREATE TRIGGER trg_log_stock_variants_upd AFTER UPDATE OF stock_quantity ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.log_stock_movement();

-- 2. El stock de un producto con variantes es la suma de sus variantes -----------
CREATE OR REPLACE FUNCTION public.sync_product_stock_from_variants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _pids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    _pids := ARRAY[OLD.product_id];
  ELSIF TG_OP = 'UPDATE' THEN
    _pids := ARRAY[NEW.product_id, OLD.product_id];
  ELSE
    _pids := ARRAY[NEW.product_id];
  END IF;

  UPDATE products p
  SET stock_quantity = s.total
  FROM (
    SELECT pid, COALESCE((SELECT SUM(v.stock_quantity) FROM product_variants v WHERE v.product_id = pid), 0)::integer AS total
    FROM unnest(_pids) AS pid
    WHERE pid IS NOT NULL
  ) s
  WHERE p.id = s.pid AND p.stock_quantity IS DISTINCT FROM s.total;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_stock_to_product ON public.product_variants;
CREATE TRIGGER trg_variant_stock_to_product
AFTER INSERT OR DELETE OR UPDATE OF stock_quantity, product_id ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_from_variants();

-- Puesta al día: productos con variantes cuyo stock no es la suma de ellas.
UPDATE public.products p
SET stock_quantity = s.total
FROM (SELECT product_id, SUM(stock_quantity)::integer AS total FROM public.product_variants GROUP BY product_id) s
WHERE p.id = s.product_id AND p.stock_quantity IS DISTINCT FROM s.total;

-- 3. Niveles de Shopify -----------------------------------------------------------
ALTER TABLE public.shopify_inventory_levels ADD COLUMN IF NOT EXISTS remote_updated_at timestamptz;

-- Stock local = disponible en la ubicación de la tienda + envíos pendientes a Shopify.
-- Solo para artículos emparejados (con filas de nivel). Solo service_role.
CREATE OR REPLACE FUNCTION public.recompute_local_stock(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _source text DEFAULT 'shopify'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _loc text;
  _shop integer;
  _pending integer;
  _current integer;
  _target integer;
BEGIN
  SELECT c.default_location_gid INTO _loc FROM shopify_connections c WHERE c.business_id = _business_id;
  IF _loc IS NULL THEN RETURN; END IF;

  IF _variant_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM shopify_inventory_levels l WHERE l.business_id = _business_id AND l.local_variant_id = _variant_id) THEN
      RETURN;
    END IF;
    SELECT v.stock_quantity INTO _current FROM product_variants v
    WHERE v.id = _variant_id AND v.business_id = _business_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT COALESCE(SUM(l.available), 0) INTO _shop FROM shopify_inventory_levels l
    WHERE l.business_id = _business_id AND l.local_variant_id = _variant_id AND l.location_gid = _loc;
    SELECT COALESCE(SUM(q.delta), 0) INTO _pending FROM shopify_inventory_pushes q
    WHERE q.business_id = _business_id AND q.local_variant_id = _variant_id AND q.status IN ('pending', 'failed');
    _target := _shop + _pending;
    IF _current IS DISTINCT FROM _target THEN
      PERFORM set_config('app.stock_source', _source, true);
      UPDATE product_variants SET stock_quantity = _target, updated_at = now() WHERE id = _variant_id;
      PERFORM set_config('app.stock_source', '', true);
    END IF;

  ELSIF _product_id IS NOT NULL THEN
    -- Producto sin variantes locales: su nivel está enlazado al producto.
    IF EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = _product_id) THEN RETURN; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM shopify_inventory_levels l
      WHERE l.business_id = _business_id AND l.local_product_id = _product_id AND l.local_variant_id IS NULL
    ) THEN
      RETURN;
    END IF;
    SELECT p.stock_quantity INTO _current FROM products p
    WHERE p.id = _product_id AND p.business_id = _business_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT COALESCE(SUM(l.available), 0) INTO _shop FROM shopify_inventory_levels l
    WHERE l.business_id = _business_id AND l.local_product_id = _product_id AND l.local_variant_id IS NULL
      AND l.location_gid = _loc;
    SELECT COALESCE(SUM(q.delta), 0) INTO _pending FROM shopify_inventory_pushes q
    WHERE q.business_id = _business_id AND q.local_product_id = _product_id AND q.local_variant_id IS NULL
      AND q.status IN ('pending', 'failed');
    _target := _shop + _pending;
    IF _current IS DISTINCT FROM _target THEN
      PERFORM set_config('app.stock_source', _source, true);
      UPDATE products SET stock_quantity = _target WHERE id = _product_id;
      PERFORM set_config('app.stock_source', '', true);
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_local_stock(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_local_stock(uuid, uuid, uuid, text) TO service_role;

-- Aplica niveles de Shopify (webhook inventory_levels/update o refresco completo).
-- _levels: [{inventory_item_gid, location_gid, available, updated_at, location_name}]
CREATE OR REPLACE FUNCTION public.apply_shopify_inventory_levels(
  _business_id uuid,
  _levels jsonb,
  _source text DEFAULT 'shopify'
)
RETURNS TABLE(applied integer, stale integer, unknown integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _l record;
  _ref shopify_inventory_levels%ROWTYPE;
  _applied integer := 0;
  _stale integer := 0;
  _unknown integer := 0;
BEGIN
  IF _source NOT IN ('shopify', 'import') THEN
    RAISE EXCEPTION 'Origen no válido: %', _source USING ERRCODE = '22023';
  END IF;
  IF _levels IS NULL OR jsonb_typeof(_levels) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR _l IN
    SELECT * FROM jsonb_to_recordset(_levels)
      AS x(inventory_item_gid text, location_gid text, available integer, updated_at timestamptz, location_name text)
  LOOP
    -- Fila de referencia del artículo (la de esa ubicación, si existe).
    SELECT * INTO _ref FROM shopify_inventory_levels s
    WHERE s.business_id = _business_id AND s.inventory_item_gid = _l.inventory_item_gid
    ORDER BY (s.location_gid = _l.location_gid) DESC
    LIMIT 1;
    IF NOT FOUND OR _l.location_gid IS NULL OR _l.available IS NULL THEN
      _unknown := _unknown + 1;
      CONTINUE;
    END IF;

    IF _ref.location_gid = _l.location_gid THEN
      IF _ref.remote_updated_at IS NOT NULL AND _l.updated_at IS NOT NULL AND _l.updated_at < _ref.remote_updated_at THEN
        _stale := _stale + 1;
        CONTINUE;
      END IF;
      UPDATE shopify_inventory_levels
      SET available = _l.available,
          remote_updated_at = COALESCE(_l.updated_at, now()),
          location_name = COALESCE(_l.location_name, location_name),
          synced_at = now(),
          updated_at = now()
      WHERE id = _ref.id;
    ELSE
      -- Primera vez que el artículo aparece en esta ubicación.
      INSERT INTO shopify_inventory_levels (
        business_id, variant_external_id, local_variant_id, local_product_id,
        inventory_item_gid, location_gid, location_name, available, remote_updated_at, synced_at
      ) VALUES (
        _business_id, _ref.variant_external_id, _ref.local_variant_id, _ref.local_product_id,
        _l.inventory_item_gid, _l.location_gid, _l.location_name, _l.available, COALESCE(_l.updated_at, now()), now()
      )
      ON CONFLICT (business_id, inventory_item_gid, location_gid) DO NOTHING;
    END IF;

    _applied := _applied + 1;
    PERFORM recompute_local_stock(_business_id, _ref.local_product_id, _ref.local_variant_id, _source);
  END LOOP;

  RETURN QUERY SELECT _applied, _stale, _unknown;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_shopify_inventory_levels(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_shopify_inventory_levels(uuid, jsonb, text) TO service_role;

-- 4. Origen en las funciones que mueven stock -------------------------------------
-- Venta del TPV (cuerpo de la 0017 con la marca de origen).
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
  PERFORM set_config('app.stock_source', 'sale', true);
  PERFORM set_config('app.stock_ref', NEW.sale_id::text, true);

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

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);
  RETURN NEW;
END;
$$;

-- Devolución del TPV (cuerpo de la 0023 con la marca de origen).
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
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) e
    GROUP BY e->>'sale_item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cada línea de la venta solo puede aparecer una vez en la devolución' USING ERRCODE = '22023';
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

  PERFORM set_config('app.stock_source', 'return', true);
  PERFORM set_config('app.stock_ref', _return_id::text, true);

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
    -- Todo lo ya devuelto de esta línea, incluida esta misma devolución.
    SELECT COALESCE(SUM(ri.quantity), 0) INTO _already
    FROM sale_return_items ri
    WHERE ri.sale_item_id = _sale_item.id;
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

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);

  UPDATE sale_returns sr SET total = _total WHERE sr.id = _return_id;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) TO authenticated, service_role;

-- 5. Pedidos online ----------------------------------------------------------------
-- Los de Shopify no tocan el stock local (Shopify lo mueve y llega por webhook).
-- Los creados en Pymova sí, y se mandan a Shopify por la cola.
CREATE OR REPLACE FUNCTION public.apply_online_order_stock(_order_id uuid, _direction integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _o record;
  _it record;
  _available integer;
  _changed boolean;
BEGIN
  SELECT o.business_id, o.source INTO _o FROM online_orders o WHERE o.id = _order_id;
  IF NOT FOUND OR _o.source = 'shopify' THEN RETURN; END IF;

  PERFORM set_config('app.stock_source', 'online_order', true);
  PERFORM set_config('app.stock_ref', _order_id::text, true);

  FOR _it IN SELECT * FROM online_order_items WHERE order_id = _order_id LOOP
    _changed := false;
    IF _it.variant_id IS NOT NULL THEN
      IF _direction < 0 THEN
        SELECT stock_quantity INTO _available FROM product_variants
        WHERE id = _it.variant_id AND business_id = _o.business_id FOR UPDATE;
        IF _available IS NOT NULL AND _available < _it.quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para %', _it.product_name;
        END IF;
      END IF;
      UPDATE product_variants
        SET stock_quantity = GREATEST(0, stock_quantity + (_direction * _it.quantity)::integer), updated_at = now()
        WHERE id = _it.variant_id AND business_id = _o.business_id;
      _changed := FOUND;
    ELSIF _it.product_id IS NOT NULL THEN
      IF _direction < 0 THEN
        SELECT stock_quantity INTO _available FROM products
          WHERE id = _it.product_id AND business_id = _o.business_id AND track_inventory IS TRUE FOR UPDATE;
        IF _available IS NOT NULL AND _available < _it.quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para %', _it.product_name;
        END IF;
      END IF;
      UPDATE products
        SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) + (_direction * _it.quantity)::integer)
        WHERE id = _it.product_id AND business_id = _o.business_id AND track_inventory IS TRUE;
      _changed := FOUND;
    END IF;

    IF _changed THEN
      PERFORM enqueue_shopify_inventory_push(
        _o.business_id, _it.product_id, _it.variant_id, (_direction * _it.quantity)::integer,
        'online_order', 'online_order_items', _it.id
      );
    END IF;
  END LOOP;

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_online_order_stock(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Devolución de un pedido online (cuerpo de 20260730170011). Si el pedido es de
-- Shopify y se repone, el +1 se manda a la tienda en Shopify por la cola (el
-- reembolso en Shopify no repone stock) y el stock local lo refleja al momento.
CREATE OR REPLACE FUNCTION public.create_online_order_return(
  _order_id uuid, _kind text DEFAULT 'return', _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL, _total numeric DEFAULT 0, _restock boolean DEFAULT true)
RETURNS TABLE(return_id uuid, return_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _o record;
  _id uuid;
  _num text;
  _n integer;
  _it record;
BEGIN
  SELECT * INTO _o FROM public.online_orders WHERE id = _order_id FOR UPDATE;
  IF _o IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF NOT (public.has_min_role(_o.business_id, 'staff') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permisos para registrar devoluciones';
  END IF;

  -- Columna calificada: la versión anterior fallaba siempre con «return_number is ambiguous».
  SELECT COALESCE(MAX(NULLIF(regexp_replace(r.return_number, '\D', '', 'g'), '')::integer), 0) + 1
    INTO _n FROM public.online_order_returns r WHERE r.business_id = _o.business_id;
  _num := 'DEVW-' || LPAD(_n::text, 6, '0');

  INSERT INTO public.online_order_returns(business_id, order_id, return_number, kind, reason, refund_method, total, restock, created_by)
  VALUES (_o.business_id, _order_id, _num, COALESCE(_kind,'return'), _reason, _refund_method, COALESCE(_total,0), COALESCE(_restock,true), auth.uid())
  RETURNING id INTO _id;

  IF COALESCE(_restock, true) AND _o.stock_applied THEN
    IF _o.source = 'shopify' THEN
      FOR _it IN SELECT * FROM public.online_order_items WHERE order_id = _order_id LOOP
        PERFORM public.enqueue_shopify_inventory_push(
          _o.business_id, _it.product_id, _it.variant_id, _it.quantity::integer,
          'return', 'online_order_items', _it.id
        );
        PERFORM public.recompute_local_stock(_o.business_id, _it.product_id, _it.variant_id, 'return');
      END LOOP;
    ELSE
      PERFORM public.apply_online_order_stock(_order_id, 1);
    END IF;
    UPDATE public.online_orders SET stock_applied = false WHERE id = _order_id;
  END IF;

  UPDATE public.online_orders SET status = 'returned' WHERE id = _order_id;

  RETURN QUERY SELECT _id, _num;
END;
$$;

REVOKE ALL ON FUNCTION public.create_online_order_return(uuid, text, text, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_online_order_return(uuid, text, text, text, numeric, boolean) TO authenticated, service_role;