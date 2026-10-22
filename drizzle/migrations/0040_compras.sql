-- Compras a proveedor con recepción. Sustituyen a las compras de Stockagile.
--
-- Una compra lleva proveedor, ubicación de destino (una ubicación de Shopify; vacía = la de
-- la tienda), temporada y líneas con cantidad pedida, recibida, coste y descuento. Se recibe
-- por partes; cada recepción queda guardada. Al recibir:
--   · si la ubicación es la de la tienda, sube el stock de PYMOVA (que es el de esa ubicación);
--   · va a la cola de stock de Shopify con la ubicación de la compra y su coste;
--   · con Stockagile conectado, va también a su cola con la ubicación (almacén del mismo nombre);
--   · el coste del artículo pasa a ser el último de compra (neto de descuento).
-- Crean y reciben quienes pueden ajustar stock (member_can 'adjust_stock'). Todo por funciones.

-- 1. Tablas ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  tax_id text,
  email text,
  phone text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON public.suppliers (business_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  location_gid text,
  location_name text,
  season text,
  expected_at date,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  ordered_at timestamptz,
  received_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS purchase_orders_business_idx ON public.purchase_orders (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  sku text,
  barcode text,
  qty_ordered integer NOT NULL CHECK (qty_ordered > 0),
  qty_received integer NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_received <= qty_ordered)
);
CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON public.purchase_order_items (order_id);

CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_receipts_order_idx ON public.purchase_receipts (order_id, created_at);

CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0
);

-- Lectura para quien puede ajustar stock (las compras llevan costes); escritura por funciones.
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers, public.purchase_orders, public.purchase_order_items,
  public.purchase_receipts, public.purchase_receipt_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.suppliers, public.purchase_orders, public.purchase_order_items,
  public.purchase_receipts, public.purchase_receipt_items TO authenticated;
GRANT ALL ON public.suppliers, public.purchase_orders, public.purchase_order_items,
  public.purchase_receipts, public.purchase_receipt_items TO service_role;
DROP POLICY IF EXISTS "Stock managers view suppliers" ON public.suppliers;
CREATE POLICY "Stock managers view suppliers" ON public.suppliers
  FOR SELECT TO authenticated USING (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers view purchase orders" ON public.purchase_orders;
CREATE POLICY "Stock managers view purchase orders" ON public.purchase_orders
  FOR SELECT TO authenticated USING (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers view purchase order items" ON public.purchase_order_items;
CREATE POLICY "Stock managers view purchase order items" ON public.purchase_order_items
  FOR SELECT TO authenticated USING (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers view purchase receipts" ON public.purchase_receipts;
CREATE POLICY "Stock managers view purchase receipts" ON public.purchase_receipts
  FOR SELECT TO authenticated USING (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers view purchase receipt items" ON public.purchase_receipt_items;
CREATE POLICY "Stock managers view purchase receipt items" ON public.purchase_receipt_items
  FOR SELECT TO authenticated USING (public.member_can(business_id, 'adjust_stock'));

-- 2. Colas y registro: ubicación y coste por movimiento; origen «purchase» -------------------
ALTER TABLE public.shopify_inventory_pushes ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);
ALTER TABLE public.stockagile_stock_moves ADD COLUMN IF NOT EXISTS location_gid text;

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_source_check
  CHECK (source IN ('sale', 'return', 'online_order', 'shopify', 'import', 'manual', 'initial', 'other', 'purchase'));

-- 3. Ubicaciones de stock del negocio (las de Shopify), para elegir el destino --------------
CREATE OR REPLACE FUNCTION public.get_stock_locations(_business_id uuid)
RETURNS TABLE(location_gid text, location_name text, is_default boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.location_gid, max(l.location_name), bool_or(l.location_gid = c.default_location_gid)
  FROM shopify_inventory_levels l
  LEFT JOIN shopify_connections c ON c.business_id = l.business_id
  WHERE l.business_id = _business_id AND public.member_can(_business_id, 'adjust_stock')
  GROUP BY l.location_gid
  ORDER BY 3 DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.get_stock_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_locations(uuid) TO authenticated, service_role;

-- 4. Proveedores ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_supplier(
  _business_id uuid,
  _supplier_id uuid,
  _name text,
  _tax_id text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _clean text := btrim(COALESCE(_name, ''));
BEGIN
  IF NOT member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar proveedores' USING ERRCODE = '42501';
  END IF;
  IF _clean = '' THEN
    RAISE EXCEPTION 'Escribe el nombre del proveedor' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM suppliers s
    WHERE s.business_id = _business_id AND lower(btrim(s.name)) = lower(_clean) AND s.id IS DISTINCT FROM _supplier_id
  ) THEN
    RAISE EXCEPTION 'Ya hay un proveedor llamado %', _clean USING ERRCODE = '23505';
  END IF;
  IF _supplier_id IS NULL THEN
    INSERT INTO suppliers (business_id, name, tax_id, email, phone, notes)
    VALUES (_business_id, _clean, NULLIF(btrim(_tax_id), ''), NULLIF(btrim(_email), ''), NULLIF(btrim(_phone), ''), NULLIF(btrim(_notes), ''))
    RETURNING id INTO _id;
  ELSE
    UPDATE suppliers s
    SET name = _clean, tax_id = NULLIF(btrim(_tax_id), ''), email = NULLIF(btrim(_email), ''),
        phone = NULLIF(btrim(_phone), ''), notes = NULLIF(btrim(_notes), ''), updated_at = now()
    WHERE s.id = _supplier_id AND s.business_id = _business_id
    RETURNING s.id INTO _id;
    IF _id IS NULL THEN
      RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_supplier(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_supplier(uuid, uuid, text, text, text, text, text) TO authenticated, service_role;

-- 5. Guardar una compra (crear o editar) ----------------------------------------------------
-- Las líneas se sustituyen enteras mientras no se haya recibido nada.
-- _items: [{ variant_id | product_id, quantity, unit_cost, discount_pct }]
CREATE OR REPLACE FUNCTION public.save_purchase_order(
  _business_id uuid,
  _order_id uuid,
  _supplier_id uuid,
  _location_gid text,
  _season text,
  _expected_at date,
  _notes text,
  _items jsonb
)
RETURNS TABLE(order_id uuid, order_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _id uuid := _order_id;
  _number text;
  _status text;
  _location_name text;
  _item jsonb;
  _vid uuid;
  _pid uuid;
  _qty integer;
  _cost numeric;
  _disc numeric;
  _name text;
  _sku text;
  _barcode text;
  _n integer;
BEGIN
  IF NOT member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar compras' USING ERRCODE = '42501';
  END IF;
  IF _supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers s WHERE s.id = _supplier_id AND s.business_id = _business_id
  ) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(_location_gid, '')), '') IS NOT NULL THEN
    SELECT l.location_name INTO _location_name FROM shopify_inventory_levels l
    WHERE l.business_id = _business_id AND l.location_gid = _location_gid
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa ubicación no es de este negocio' USING ERRCODE = '22023';
    END IF;
  ELSE
    _location_gid := NULL;
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La compra debe tener al menos un artículo' USING ERRCODE = '22023';
  END IF;

  IF _id IS NULL THEN
    -- Número: PC-AA-0001 por negocio y año (distinto de los PC… de Stockagile).
    PERFORM pg_advisory_xact_lock(hashtextextended('purchase_number:' || _business_id::text, 0));
    SELECT COALESCE(MAX(NULLIF(split_part(p.number, '-', 3), '')::integer), 0) + 1 INTO _n
    FROM purchase_orders p
    WHERE p.business_id = _business_id AND p.number LIKE 'PC-' || to_char(now() AT TIME ZONE 'Europe/Madrid', 'YY') || '-%';
    _number := 'PC-' || to_char(now() AT TIME ZONE 'Europe/Madrid', 'YY') || '-' || LPAD(_n::text, 4, '0');
    INSERT INTO purchase_orders (business_id, number, supplier_id, location_gid, location_name, season, expected_at, notes, created_by)
    VALUES (_business_id, _number, _supplier_id, _location_gid, _location_name, NULLIF(btrim(_season), ''), _expected_at, NULLIF(btrim(_notes), ''), auth.uid())
    RETURNING id INTO _id;
  ELSE
    SELECT p.number, p.status INTO _number, _status FROM purchase_orders p
    WHERE p.id = _id AND p.business_id = _business_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE = '22023';
    END IF;
    IF _status NOT IN ('draft', 'ordered') OR EXISTS (
      SELECT 1 FROM purchase_order_items i WHERE i.order_id = _id AND i.qty_received > 0
    ) THEN
      RAISE EXCEPTION 'La compra ya tiene recepciones o está cerrada: no se puede editar' USING ERRCODE = '22023';
    END IF;
    UPDATE purchase_orders p
    SET supplier_id = _supplier_id, location_gid = _location_gid, location_name = _location_name,
        season = NULLIF(btrim(_season), ''), expected_at = _expected_at, notes = NULLIF(btrim(_notes), ''), updated_at = now()
    WHERE p.id = _id;
    DELETE FROM purchase_order_items i WHERE i.order_id = _id;
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _vid := NULLIF(NULLIF(_item->>'variant_id', ''), 'null')::uuid;
    _pid := NULLIF(NULLIF(_item->>'product_id', ''), 'null')::uuid;
    _qty := (_item->>'quantity')::integer;
    _cost := ROUND(COALESCE(NULLIF(_item->>'unit_cost', '')::numeric, 0), 2);
    _disc := ROUND(COALESCE(NULLIF(_item->>'discount_pct', '')::numeric, 0), 2);
    IF _qty IS NULL OR _qty <= 0 THEN
      RAISE EXCEPTION 'Las cantidades deben ser mayores que 0' USING ERRCODE = '22023';
    END IF;
    IF _cost < 0 OR _disc < 0 OR _disc > 100 THEN
      RAISE EXCEPTION 'El coste no puede ser negativo y el descuento va de 0 a 100' USING ERRCODE = '22023';
    END IF;
    IF _vid IS NOT NULL THEN
      SELECT p.name || ' · ' || v.name, v.sku, v.barcode, v.product_id INTO _name, _sku, _barcode, _pid
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = _vid AND v.business_id = _business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Un artículo de la compra no pertenece a este negocio' USING ERRCODE = '42501';
      END IF;
    ELSIF _pid IS NOT NULL THEN
      SELECT p.name, p.sku, p.barcode INTO _name, _sku, _barcode FROM products p
      WHERE p.id = _pid AND p.business_id = _business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Un artículo de la compra no pertenece a este negocio' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = _pid) THEN
        RAISE EXCEPTION '"%" tiene tallas o variantes: elige cuáles', _name USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Cada línea debe ser un artículo del catálogo' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM purchase_order_items i
      WHERE i.order_id = _id AND i.product_id IS NOT DISTINCT FROM _pid AND i.variant_id IS NOT DISTINCT FROM _vid
    ) THEN
      RAISE EXCEPTION '"%" está repetido en la compra', _name USING ERRCODE = '22023';
    END IF;
    INSERT INTO purchase_order_items (business_id, order_id, product_id, variant_id, product_name, sku, barcode, qty_ordered, unit_cost, discount_pct)
    VALUES (_business_id, _id, _pid, _vid, _name, _sku, _barcode, _qty, _cost, _disc);
  END LOOP;

  RETURN QUERY SELECT _id, _number;
END;
$$;
REVOKE ALL ON FUNCTION public.save_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb) TO authenticated, service_role;

-- 6. Pasar a «pedida» o cancelar ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_purchase_order_status(_business_id uuid, _order_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current text;
BEGIN
  IF NOT member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar compras' USING ERRCODE = '42501';
  END IF;
  SELECT p.status INTO _current FROM purchase_orders p WHERE p.id = _order_id AND p.business_id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE = '22023';
  END IF;
  IF _status = 'ordered' AND _current = 'draft' THEN
    UPDATE purchase_orders p SET status = 'ordered', ordered_at = now(), updated_at = now() WHERE p.id = _order_id;
  ELSIF _status = 'cancelled' AND _current IN ('draft', 'ordered') THEN
    UPDATE purchase_orders p SET status = 'cancelled', updated_at = now() WHERE p.id = _order_id;
  ELSE
    RAISE EXCEPTION 'No se puede pasar una compra de % a %', _current, _status USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_purchase_order_status(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_order_status(uuid, uuid, text) TO authenticated, service_role;

-- 7. Recibir (todo o parte) -----------------------------------------------------------------
-- _lines: [{ item_id, quantity }]
CREATE OR REPLACE FUNCTION public.receive_purchase_order(_business_id uuid, _order_id uuid, _lines jsonb, _notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _o purchase_orders%ROWTYPE;
  _receipt uuid;
  _line jsonb;
  _it purchase_order_items%ROWTYPE;
  _qty integer;
  _net numeric;
  _ritem uuid;
  _default_loc text;
  _push_enabled boolean;
  _stockagile boolean;
  _local boolean;
BEGIN
  IF NOT member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para recibir compras' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _o FROM purchase_orders p WHERE p.id = _order_id AND p.business_id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE = '22023';
  END IF;
  IF _o.status NOT IN ('draft', 'ordered', 'partial') THEN
    RAISE EXCEPTION 'Esta compra ya está % y no admite recepciones', CASE _o.status WHEN 'received' THEN 'recibida' ELSE 'cancelada' END USING ERRCODE = '22023';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Indica qué artículos han llegado' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_lines) e GROUP BY e->>'item_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Cada línea solo puede aparecer una vez en la recepción' USING ERRCODE = '22023';
  END IF;

  SELECT c.default_location_gid, COALESCE(c.stock_push_enabled, false) INTO _default_loc, _push_enabled
  FROM shopify_connections c WHERE c.business_id = _business_id;
  _push_enabled := COALESCE(_push_enabled, false);
  _stockagile := EXISTS (SELECT 1 FROM stockagile_connections s WHERE s.business_id = _business_id AND s.enabled);
  -- El stock de PYMOVA es el de la ubicación de la tienda: solo sube si la compra va allí.
  _local := _o.location_gid IS NULL OR _o.location_gid IS NOT DISTINCT FROM _default_loc;

  INSERT INTO purchase_receipts (business_id, order_id, notes, created_by)
  VALUES (_business_id, _order_id, NULLIF(btrim(_notes), ''), auth.uid())
  RETURNING id INTO _receipt;

  PERFORM set_config('app.stock_source', 'purchase', true);
  PERFORM set_config('app.stock_ref', _receipt::text, true);

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _qty := (_line->>'quantity')::integer;
    IF _qty IS NULL OR _qty <= 0 THEN
      RAISE EXCEPTION 'Las cantidades recibidas deben ser mayores que 0' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO _it FROM purchase_order_items i
    WHERE i.id = (_line->>'item_id')::uuid AND i.order_id = _order_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una línea no es de esta compra' USING ERRCODE = '22023';
    END IF;
    IF _it.qty_received + _qty > _it.qty_ordered THEN
      RAISE EXCEPTION 'De "%" quedan % por recibir', _it.product_name, _it.qty_ordered - _it.qty_received USING ERRCODE = '22023';
    END IF;
    _net := ROUND(_it.unit_cost * (1 - _it.discount_pct / 100), 2);

    INSERT INTO purchase_receipt_items (business_id, receipt_id, order_item_id, quantity, unit_cost)
    VALUES (_business_id, _receipt, _it.id, _qty, _net)
    RETURNING id INTO _ritem;
    UPDATE purchase_order_items i SET qty_received = i.qty_received + _qty WHERE i.id = _it.id;

    -- Stock de PYMOVA (ubicación de la tienda) y coste del artículo.
    IF _it.variant_id IS NOT NULL THEN
      UPDATE product_variants v
      SET stock_quantity = CASE WHEN _local THEN v.stock_quantity + _qty ELSE v.stock_quantity END,
          cost_price = CASE WHEN _net > 0 THEN _net ELSE v.cost_price END,
          updated_at = now()
      WHERE v.id = _it.variant_id AND v.business_id = _business_id;
    ELSIF _it.product_id IS NOT NULL THEN
      UPDATE products p
      SET stock_quantity = CASE WHEN _local AND p.track_inventory THEN COALESCE(p.stock_quantity, 0) + _qty ELSE p.stock_quantity END,
          cost_price = CASE WHEN _net > 0 THEN _net ELSE p.cost_price END
      WHERE p.id = _it.product_id AND p.business_id = _business_id;
    END IF;

    -- A Shopify, en la ubicación de la compra y con el coste.
    IF _push_enabled AND (_it.variant_id IS NOT NULL OR _it.product_id IS NOT NULL) THEN
      INSERT INTO shopify_inventory_pushes (
        business_id, local_product_id, local_variant_id, delta, reason, source_table, source_id, location_gid, unit_cost
      ) VALUES (
        _business_id, _it.product_id, _it.variant_id, _qty, 'purchase', 'purchase_receipt_items', _ritem,
        COALESCE(_o.location_gid, _default_loc), CASE WHEN _net > 0 THEN _net END
      );
    END IF;

    -- A Stockagile mientras siga conectado (almacén con el nombre de la ubicación).
    IF _stockagile AND (_it.variant_id IS NOT NULL OR _it.product_id IS NOT NULL) THEN
      INSERT INTO stockagile_stock_moves (
        business_id, local_product_id, local_variant_id, quantity, reason, source_table, source_id, location_gid
      ) VALUES (
        _business_id, _it.product_id, _it.variant_id, _qty, 'purchase', 'purchase_receipt_items', _ritem, _o.location_gid
      )
      ON CONFLICT (source_table, source_id) DO NOTHING;
    END IF;
  END LOOP;

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);

  UPDATE purchase_orders p
  SET status = CASE WHEN NOT EXISTS (
                 SELECT 1 FROM purchase_order_items i WHERE i.order_id = _order_id AND i.qty_received < i.qty_ordered
               ) THEN 'received' ELSE 'partial' END,
      ordered_at = COALESCE(p.ordered_at, now()),
      received_at = CASE WHEN NOT EXISTS (
                 SELECT 1 FROM purchase_order_items i WHERE i.order_id = _order_id AND i.qty_received < i.qty_ordered
               ) THEN now() ELSE p.received_at END,
      updated_at = now()
  WHERE p.id = _order_id;

  RETURN _receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, uuid, jsonb, text) TO authenticated, service_role;

-- 8. Stock de la tienda: lo pendiente para otra ubicación no cuenta (cuerpo de la 0024) -----
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
    WHERE q.business_id = _business_id AND q.local_variant_id = _variant_id AND q.status IN ('pending', 'failed')
      AND (q.location_gid IS NULL OR q.location_gid = _loc);
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
      AND q.status IN ('pending', 'failed')
      AND (q.location_gid IS NULL OR q.location_gid = _loc);
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
