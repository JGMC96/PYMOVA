-- Devolver y cambiar tickets de Stockagile desde PYMOVA (plan aprobado el 2026-11-09).
-- - Es una devolución normal de PYMOVA (DEV-…), sin venta de PYMOVA enlazada: sirven el arqueo,
--   los vales, el PIN y las colas de stock de siempre (los triggers de sale_return_items).
-- - La copia de Stockagile borra y recrea las líneas al sincronizar: lo devuelto se enlaza por
--   ticket y clave del artículo, nunca por el id de la línea.
-- - Queda = comprado − devuelto en Stockagile − devuelto en PYMOVA.
-- - Solo tickets del almacén de la tienda y de los últimos 180 días.
-- - Sin reembolso en Shopify: estos tickets no tienen pedido allí.

-- 1. Columnas -----------------------------------------------------------------------------------
ALTER TABLE public.sale_returns ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS stockagile_sale_id uuid REFERENCES public.stockagile_sales(id) ON DELETE CASCADE;
ALTER TABLE public.sale_returns DROP CONSTRAINT IF EXISTS sale_returns_one_origin;
ALTER TABLE public.sale_returns ADD CONSTRAINT sale_returns_one_origin
  CHECK (num_nonnulls(sale_id, stockagile_sale_id) = 1);
CREATE INDEX IF NOT EXISTS sale_returns_stockagile_sale_idx
  ON public.sale_returns (stockagile_sale_id) WHERE stockagile_sale_id IS NOT NULL;

ALTER TABLE public.sale_return_items ADD COLUMN IF NOT EXISTS stockagile_line_key text;
GRANT SELECT (stockagile_line_key) ON public.sale_return_items TO authenticated, anon;

-- Almacén de Stockagile cuyos tickets se pueden devolver aquí. Sin valor, ninguno.
ALTER TABLE public.stockagile_connections ADD COLUMN IF NOT EXISTS returns_warehouse_name text;
UPDATE public.stockagile_connections
SET returns_warehouse_name = 'Tienda Valencia'
WHERE business_id = 'c84f3b72-ae45-4501-a454-79cf47b888b4' AND returns_warehouse_name IS NULL;

-- 2. Clave del artículo (internas) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stockagile_normal_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(_name, '')), '\s+', ' ', 'g'));
$$;
REVOKE ALL ON FUNCTION public.stockagile_normal_name(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stockagile_line_key(_barcode text, _name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE('b:' || NULLIF(btrim(_barcode), ''), 'n:' || public.stockagile_normal_name(_name));
$$;
REVOKE ALL ON FUNCTION public.stockagile_line_key(text, text) FROM PUBLIC, anon, authenticated;

-- 3. Artículos de un ticket y cuánto queda por devolver (interna) ---------------------------------
-- Una sola fórmula para enseñar y para devolver. Las líneas positivas de un ticket de cambio
-- también se pueden devolver. Las líneas con total negativo o sin total no se ofrecen.
CREATE OR REPLACE FUNCTION public.stockagile_return_lines(_sale_id uuid)
RETURNS TABLE(
  line_key text,
  product_name text,
  size text,
  color text,
  barcode text,
  quantity integer,
  line_total numeric,
  returned_stockagile integer,
  returned_pymova integer,
  remaining integer,
  variant_id uuid,
  variant_match text,
  variant_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH t AS (
    SELECT s.* FROM stockagile_sales s WHERE s.id = _sale_id
  ), art AS (
    SELECT stockagile_line_key(i.barcode, i.product_name) AS k,
           min(i.product_name) AS pn,
           min(i.size) AS sz,
           min(i.color) AS col,
           max(NULLIF(btrim(i.barcode), '')) AS bc,
           sum(i.quantity)::integer AS q,
           sum(i.total) AS tot,
           (array_agg(i.variant_id) FILTER (WHERE i.variant_id IS NOT NULL))[1] AS var
    FROM stockagile_sale_items i
    WHERE i.sale_id = _sale_id AND i.quantity > 0 AND i.total >= 0
    GROUP BY 1
  ), done AS (
    SELECT a.*,
      -- Devuelto en Stockagile: lo negativo de sus devoluciones y, en una venta, de ese mismo
      -- ticket. En un ticket de cambio, lo negativo es del ticket de origen, no de este.
      COALESCE((
        SELECT sum(abs(r.quantity))::integer
        FROM t
        JOIN stockagile_sales rs ON rs.business_id = t.business_id AND NOT rs.deleted
          AND (rs.return_of_external_id = t.external_id OR (rs.id = t.id AND NOT t.is_return))
        JOIN stockagile_sale_items r ON r.sale_id = rs.id AND r.quantity < 0
        WHERE NULLIF(btrim(r.barcode), '') = a.bc
           OR stockagile_normal_name(r.product_name) = stockagile_normal_name(a.pn)
      ), 0) AS in_stockagile,
      COALESCE((
        SELECT sum(ri.quantity)::integer
        FROM sale_returns sr
        JOIN sale_return_items ri ON ri.return_id = sr.id
        WHERE sr.stockagile_sale_id = _sale_id AND ri.stockagile_line_key = a.k
      ), 0) AS in_pymova,
      CASE WHEN a.sz IS NOT NULL AND right(a.pn, length(a.sz) + 3) = ' - ' || a.sz
           THEN left(a.pn, length(a.pn) - length(a.sz) - 3) ELSE a.pn END AS base
    FROM art a
  ), matched AS (
    SELECT d.*,
      (SELECT array_agg(v.id) FROM t JOIN product_variants v ON v.business_id = t.business_id
       WHERE d.bc IS NOT NULL AND v.barcode = d.bc) AS by_barcode,
      (SELECT array_agg(v.id) FROM t
       JOIN products p ON p.business_id = t.business_id
         AND stockagile_normal_name(p.name) = stockagile_normal_name(d.base)
       JOIN product_variants v ON v.product_id = p.id
       WHERE d.sz IS NOT NULL
         AND (v.name = d.sz OR v.attributes->>'Talla' = d.sz OR v.attributes->>'talla' = d.sz)) AS by_name
    FROM done d
  ), resolved AS (
    SELECT m.*,
      CASE WHEN m.var IS NOT NULL THEN m.var
           WHEN cardinality(m.by_barcode) = 1 THEN m.by_barcode[1]
           WHEN cardinality(m.by_name) = 1 THEN m.by_name[1] END AS vid,
      CASE WHEN m.var IS NOT NULL OR cardinality(m.by_barcode) = 1 THEN 'code'
           WHEN cardinality(m.by_name) = 1 THEN 'name' END AS how
    FROM matched m
  )
  SELECT r.k, r.pn, r.sz, r.col, r.bc, r.q, r.tot, r.in_stockagile, r.in_pymova,
         r.q - r.in_stockagile - r.in_pymova,
         r.vid, r.how,
         (SELECT p.name || ' · ' || v.name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = r.vid)
  FROM resolved r
  ORDER BY r.pn;
$$;
REVOKE ALL ON FUNCTION public.stockagile_return_lines(uuid) FROM PUBLIC, anon, authenticated;

-- 4. ¿Se puede devolver este ticket? (interna). NULL si se puede; si no, el motivo --------------
CREATE OR REPLACE FUNCTION public.stockagile_return_blocked(_ticket public.stockagile_sales)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _warehouse text;
BEGIN
  IF _ticket.deleted THEN
    RETURN 'Este ticket está anulado en Stockagile';
  END IF;
  SELECT c.returns_warehouse_name INTO _warehouse
  FROM stockagile_connections c WHERE c.business_id = _ticket.business_id;
  IF _warehouse IS NULL OR _ticket.warehouse_name IS DISTINCT FROM _warehouse THEN
    RETURN 'Este ticket no es de la tienda: no se puede devolver aquí';
  END IF;
  IF _ticket.sold_at < now() - interval '180 days' THEN
    RETURN 'Este ticket tiene más de 180 días: ya no se puede devolver';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.stockagile_return_blocked(public.stockagile_sales) FROM PUBLIC, anon, authenticated;

-- 5. Lo que queda por devolver de un ticket -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stockagile_returnable(_business_id uuid, _sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ticket stockagile_sales%ROWTYPE;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver este ticket' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _ticket FROM stockagile_sales s WHERE s.id = _sale_id AND s.business_id = _business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'number', _ticket.number,
    'sold_at', _ticket.sold_at,
    'payment_methods', _ticket.payment_methods,
    'blocked', stockagile_return_blocked(_ticket),
    'over_returned', EXISTS (SELECT 1 FROM stockagile_return_lines(_sale_id) l WHERE l.remaining < 0),
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM stockagile_return_lines(_sale_id) l), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_stockagile_returnable(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stockagile_returnable(uuid, uuid) TO authenticated, service_role;

-- 6. Devolver (permisos, caja y vale, como create_sale_return de la 0039) --------------------------
CREATE OR REPLACE FUNCTION public.create_stockagile_return(
  _business_id uuid,
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method text DEFAULT NULL,
  _restock boolean DEFAULT true,
  _seller_session_id uuid DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS TABLE(return_id uuid, return_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _ticket stockagile_sales%ROWTYPE;
  _blocked text;
  _return_id uuid;
  _number text;
  _item jsonb;
  _line record;
  _qty numeric;
  _already numeric;
  _unit_net numeric;
  _line_total numeric;
  _total numeric := 0;
  _count integer := 0;
  _variant uuid;
  _product uuid;
  _register_id uuid;
  _seller uuid;
  _can_return boolean;
  _authorizer uuid;
  _voucher_id uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio' USING ERRCODE = '42501';
  END IF;
  IF _seller_session_id IS NOT NULL THEN
    _seller := seller_from_session(_business_id, _seller_session_id);
  ELSE
    _seller := default_seller_employee(_business_id);
  END IF;
  -- Sin permiso de devoluciones, hace falta la autorización (PIN) de alguien que lo tenga.
  IF _seller IS NOT NULL AND business_requires_seller(_business_id) THEN
    SELECT p.can_return INTO _can_return FROM employee_effective_permissions(_seller) p;
    IF NOT COALESCE(_can_return, false) THEN
      IF _authorization_id IS NULL THEN
        RAISE EXCEPTION 'Necesita autorización: esta persona no puede hacer devoluciones' USING ERRCODE = '42501';
      END IF;
      _authorizer := consume_authorization(_business_id, _authorization_id, 'return', NULL);
    END IF;
  END IF;

  -- El ticket bloqueado: dos devoluciones a la vez no gastan las mismas unidades.
  SELECT * INTO _ticket FROM stockagile_sales s WHERE s.id = _sale_id AND s.business_id = _business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE = '42501';
  END IF;
  _blocked := stockagile_return_blocked(_ticket);
  IF _blocked IS NOT NULL THEN
    RAISE EXCEPTION '%', _blocked USING ERRCODE = '22023';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una unidad a devolver' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) e GROUP BY e->>'line_key' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cada artículo del ticket solo puede aparecer una vez en la devolución' USING ERRCODE = '22023';
  END IF;
  IF _refund_method IS NULL OR _refund_method NOT IN ('cash', 'card', 'transfer', 'store_credit') THEN
    RAISE EXCEPTION 'Elige cómo se devuelve el dinero' USING ERRCODE = '22023';
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

  INSERT INTO sale_returns (
    business_id, stockagile_sale_id, return_number, reason, refund_method, restock, created_by,
    register_session_id, seller_employee_id, authorized_by_employee_id, shopify_refund_status
  ) VALUES (
    _business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid(),
    _register_id, _seller, _authorizer, 'not_applicable'
  )
  RETURNING id INTO _return_id;

  PERFORM set_config('app.stock_source', 'return', true);
  PERFORM set_config('app.stock_ref', _return_id::text, true);

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _qty := COALESCE((_item->>'quantity')::numeric, 0);
    IF _qty = 0 THEN CONTINUE; END IF;
    IF _qty < 0 OR _qty <> trunc(_qty) THEN
      RAISE EXCEPTION 'Cantidad no válida' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO _line FROM stockagile_return_lines(_sale_id) l WHERE l.line_key = _item->>'line_key';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ese artículo no está en el ticket' USING ERRCODE = '22023';
    END IF;
    IF _qty > _line.remaining THEN
      RAISE EXCEPTION 'No puedes devolver más unidades de "%" de las que quedan (%)',
        _line.product_name, GREATEST(_line.remaining, 0) USING ERRCODE = '22023';
    END IF;

    -- La talla la elige quien atiende (o la propone el ticket), siempre de este negocio.
    -- Sin talla, el par no vuelve al stock: los triggers de las colas no hacen nada.
    _variant := NULLIF(_item->>'variant_id', '')::uuid;
    _product := NULL;
    IF _variant IS NOT NULL THEN
      SELECT v.product_id INTO _product FROM product_variants v
      WHERE v.id = _variant AND v.business_id = _business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa talla no es de este negocio' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Lo cobrado por unidad (con su descuento), sobre lo acumulado: varias devoluciones
    -- parciales suman exactamente el total de la línea.
    _unit_net := _line.line_total / _line.quantity;
    _already := _line.returned_stockagile + _line.returned_pymova;
    _line_total := ROUND((_already + _qty) * _unit_net, 2) - ROUND(_already * _unit_net, 2);

    INSERT INTO sale_return_items (
      return_id, product_id, variant_id, product_name, quantity, unit_price, total, stockagile_line_key
    ) VALUES (
      _return_id, _product, _variant, _line.product_name, _qty, ROUND(_unit_net, 2), _line_total, _line.line_key
    );
    _total := _total + _line_total;
    _count := _count + 1;

    IF COALESCE(_restock, true) AND _variant IS NOT NULL THEN
      UPDATE product_variants pv SET stock_quantity = pv.stock_quantity + _qty::integer, updated_at = now()
      WHERE pv.id = _variant;
    END IF;
  END LOOP;

  IF _count = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una unidad a devolver' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_ref', '', true);

  UPDATE sale_returns sr SET total = _total WHERE sr.id = _return_id;

  -- Reembolso con vale de tienda: se crea el vale por lo devuelto, con caducidad de un año.
  IF _refund_method = 'store_credit' AND _total > 0 THEN
    INSERT INTO store_vouchers (
      business_id, code, initial_amount, balance, expires_at, client_id, source_return_id,
      origin, created_by, created_by_employee_id
    ) VALUES (
      _business_id, generate_store_voucher_code(_business_id), _total, _total, now() + interval '1 year',
      _ticket.client_id, _return_id, 'return', auth.uid(), _seller
    )
    RETURNING id INTO _voucher_id;
    INSERT INTO store_voucher_movements (business_id, voucher_id, kind, amount, balance_after, return_id, employee_id, created_by)
    VALUES (_business_id, _voucher_id, 'issue', _total, _total, _return_id, _seller, auth.uid());
  END IF;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;
REVOKE ALL ON FUNCTION public.create_stockagile_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stockagile_return(uuid, uuid, jsonb, text, text, boolean, uuid, uuid) TO authenticated, service_role;

-- 7. Ficha de la clienta: lo devuelto en PYMOVA resta del ticket de Stockagile (cuerpo de la 0046) -
CREATE OR REPLACE FUNCTION public.client_purchases(_business_id uuid)
RETURNS TABLE(client_id uuid, channel text, purchase_id uuid, number text, created_at timestamptz,
              total numeric, net numeric, status text, payment_method text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT s.client_id, 'store', s.id, s.sale_number, s.created_at, s.total,
         s.total - COALESCE((SELECT sum(r.total) FROM sale_returns r WHERE r.sale_id = s.id), 0),
         CASE WHEN EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id) THEN 'returned' ELSE 'done' END,
         s.payment_method
  FROM sales s
  WHERE s.business_id = _business_id AND s.client_id IS NOT NULL
  UNION ALL
  SELECT o.client_id, 'online', o.id, o.order_number, o.created_at, o.total,
         CASE WHEN o.status::text IN ('cancelled', 'returned') OR o.payment_status::text = 'refunded' THEN 0 ELSE o.total END,
         CASE WHEN o.payment_status::text = 'refunded' AND o.status::text NOT IN ('cancelled', 'returned') THEN 'refunded'
              ELSE o.status::text END,
         o.payment_method
  FROM online_orders o
  WHERE o.business_id = _business_id AND o.client_id IS NOT NULL
  UNION ALL
  SELECT k.client_id, 'stockagile', k.id, k.number, k.sold_at, k.total,
         k.total - COALESCE((SELECT sum(r.total) FROM sale_returns r WHERE r.stockagile_sale_id = k.id), 0),
         CASE WHEN k.is_return AND k.total <= 0 THEN 'returned'
              WHEN EXISTS (SELECT 1 FROM sale_returns r WHERE r.stockagile_sale_id = k.id) THEN 'returned'
              WHEN k.is_return THEN 'exchange' ELSE 'done' END,
         k.payment_methods
  FROM stockagile_sales k
  WHERE k.business_id = _business_id AND k.client_id IS NOT NULL AND NOT k.deleted;
$$;
REVOKE ALL ON FUNCTION public.client_purchases(uuid) FROM PUBLIC, anon, authenticated;
