-- 0057 · Edición de stock: ajustes a Stockagile y todas las tallas de una vez.
--
-- Hasta ahora un ajuste manual (adjust_stock) solo iba a Shopify. En TUILUS manda Stockagile:
-- al volcar su stock a Shopify pisaba el ajuste, y el ajuste volvía a PYMOVA deshecho.
-- - apply_manual_stock_change (interna): aplica un ajuste ya validado. Queda en stock_movements
--   (origen 'manual', con el motivo y un id de lote en reference_id) y el delta va a una sola
--   cola: con Stockagile conectado, a stockagile_stock_moves (con signo; Stockagile lo pasa a
--   Shopify), y si no, a la de Shopify como hasta ahora. Una sola vez por movimiento.
--   El alta con stock inicial no va a Stockagile: en TUILUS viene de Shopify, que ya lo tiene.
-- - adjust_stock_batch: varias tallas de un producto con un motivo, todo o nada. Cada línea
--   lleva el stock que se vio en pantalla; si ha cambiado (una venta mientras se editaba), no
--   se guarda nada. Mismo permiso que adjust_stock (member_can 'adjust_stock').
-- - adjust_stock: mismo comportamiento, ahora por apply_manual_stock_change.
-- - recompute_local_stock: un ajuste que aún no ha llegado a Stockagile cuenta como pendiente,
--   para que un aviso de Shopify con la cifra anterior no lo deshaga.
-- - get_shopify_problems: el movimiento de Stockagile se ve con su signo ((+2) o (-1)).
-- Prueba del 28/10/2026: Stockagile acepta cantidades negativas en POST /stock/move.
-- Migración idempotente, sin secretos.

-- 1. Aplicar un ajuste ya validado (interna) ------------------------------------------------
-- La fila ya está bloqueada y comprobada por quien llama. Devuelve el delta.
CREATE OR REPLACE FUNCTION public.apply_manual_stock_change(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _new_quantity integer,
  _note text,
  _batch uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current integer;
  _delta integer;
  _movement uuid;
BEGIN
  IF _variant_id IS NOT NULL THEN
    SELECT v.stock_quantity INTO _current FROM product_variants v
    WHERE v.id = _variant_id AND v.business_id = _business_id;
  ELSE
    SELECT p.stock_quantity INTO _current FROM products p
    WHERE p.id = _product_id AND p.business_id = _business_id;
  END IF;

  _delta := _new_quantity - COALESCE(_current, 0);
  IF _delta = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.stock_source', 'manual', true);
  PERFORM set_config('app.stock_note', _note, true);
  PERFORM set_config('app.stock_ref', _batch::text, true);
  IF _variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_quantity = _new_quantity, updated_at = now() WHERE id = _variant_id;
  ELSE
    UPDATE products SET stock_quantity = _new_quantity WHERE id = _product_id;
  END IF;
  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_note', '', true);
  PERFORM set_config('app.stock_ref', '', true);

  -- El movimiento que acaba de dejar log_stock_movement: identifica el ajuste en las colas.
  SELECT s.id INTO _movement FROM stock_movements s
  WHERE s.business_id = _business_id AND s.reference_id = _batch
    AND s.product_id = _product_id AND s.variant_id IS NOT DISTINCT FROM _variant_id
  ORDER BY s.created_at DESC
  LIMIT 1;
  _movement := COALESCE(_movement, gen_random_uuid());

  IF EXISTS (SELECT 1 FROM stockagile_connections c WHERE c.business_id = _business_id AND c.enabled) THEN
    INSERT INTO stockagile_stock_moves (
      business_id, local_product_id, local_variant_id, quantity, reason, source_table, source_id
    ) VALUES (
      _business_id, _product_id, _variant_id, _delta, 'adjustment', 'stock_movements', _movement
    )
    ON CONFLICT (source_table, source_id) DO NOTHING;
  ELSE
    -- A Shopify por la cola (si el artículo no está emparejado, el envío queda 'skipped').
    PERFORM enqueue_shopify_inventory_push(
      _business_id, _product_id, _variant_id, _delta, 'adjustment', 'stock_movements', _movement
    );
  END IF;

  RETURN _delta;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_manual_stock_change(uuid, uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- 2. Ajuste de una talla o de un producto sin tallas (cuerpo de la 0030) ---------------------
CREATE OR REPLACE FUNCTION public.adjust_stock(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _new_quantity integer,
  _reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _clean_reason text := btrim(COALESCE(_reason, ''));
  _product uuid;
BEGIN
  IF NOT public.member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para ajustar el stock' USING ERRCODE = '42501';
  END IF;
  IF length(_clean_reason) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo del ajuste' USING ERRCODE = '22023';
  END IF;
  IF _new_quantity IS NULL OR _new_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa' USING ERRCODE = '22023';
  END IF;

  IF _variant_id IS NOT NULL THEN
    SELECT v.product_id INTO _product
    FROM product_variants v
    WHERE v.id = _variant_id AND v.business_id = _business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La variante no pertenece a este negocio' USING ERRCODE = '42501';
    END IF;
    IF _product_id IS NOT NULL AND _product_id <> _product THEN
      RAISE EXCEPTION 'La variante no corresponde al producto indicado' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF _product_id IS NULL THEN
      RAISE EXCEPTION 'Indica el producto o la variante' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM products p
    WHERE p.id = _product_id AND p.business_id = _business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto no pertenece a este negocio' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = _product_id) THEN
      RAISE EXCEPTION 'Este producto tiene variantes: ajusta el stock de cada variante' USING ERRCODE = '22023';
    END IF;
    _product := _product_id;
  END IF;

  RETURN apply_manual_stock_change(_business_id, _product, _variant_id, _new_quantity, _clean_reason, gen_random_uuid());
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text) TO authenticated, service_role;

-- 3. Varias tallas de un producto, todo o nada ----------------------------------------------
-- _lines: [{ "variant_id": uuid | null, "expected": stock visto, "new_quantity": cantidad nueva }]
-- (variant_id null solo en un producto sin tallas). Devuelve cuántas líneas cambiaron y si
-- los cambios van a Stockagile (para que la app lo envíe al momento) o a Shopify.
CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  _business_id uuid,
  _product_id uuid,
  _lines jsonb,
  _reason text
)
RETURNS TABLE(changed integer, to_stockagile boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _clean_reason text := btrim(COALESCE(_reason, ''));
  _has_variants boolean;
  _product_name text;
  _batch uuid := gen_random_uuid();
  _line record;
  _seen uuid[] := '{}';
  _seen_product boolean := false;
  _current integer;
  _name text;
  _changed integer := 0;
BEGIN
  IF NOT public.member_can(_business_id, 'adjust_stock') THEN
    RAISE EXCEPTION 'No tienes permiso para ajustar el stock' USING ERRCODE = '42501';
  END IF;
  IF length(_clean_reason) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo del ajuste' USING ERRCODE = '22023';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'No hay cambios que guardar' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_lines) > 200 THEN
    RAISE EXCEPTION 'Demasiadas líneas en un ajuste (máximo 200)' USING ERRCODE = '22023';
  END IF;

  -- Sin bloquear el producto: una venta bloquea primero la talla y después el producto (suma
  -- de tallas), y aquí se sigue el mismo orden.
  SELECT p.name INTO _product_name FROM products p
  WHERE p.id = _product_id AND p.business_id = _business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;
  _has_variants := EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = _product_id);

  -- En orden de id, para que dos ajustes a la vez bloqueen las tallas en el mismo orden.
  FOR _line IN
    SELECT * FROM jsonb_to_recordset(_lines) AS x(variant_id uuid, expected integer, new_quantity integer)
    ORDER BY x.variant_id NULLS FIRST
  LOOP
    IF _line.new_quantity IS NULL OR _line.new_quantity < 0 THEN
      RAISE EXCEPTION 'La cantidad no puede ser negativa' USING ERRCODE = '22023';
    END IF;
    IF _line.expected IS NULL THEN
      RAISE EXCEPTION 'Falta el stock de partida de una línea' USING ERRCODE = '22023';
    END IF;

    IF _line.variant_id IS NULL THEN
      IF _has_variants THEN
        RAISE EXCEPTION 'Este producto tiene variantes: ajusta el stock de cada variante' USING ERRCODE = '22023';
      END IF;
      IF _seen_product THEN
        RAISE EXCEPTION 'El producto aparece dos veces en el ajuste' USING ERRCODE = '22023';
      END IF;
      _seen_product := true;
      SELECT p.stock_quantity INTO _current FROM products p WHERE p.id = _product_id FOR UPDATE;
      _name := _product_name;
    ELSE
      IF _line.variant_id = ANY(_seen) THEN
        RAISE EXCEPTION 'Una talla aparece dos veces en el ajuste' USING ERRCODE = '22023';
      END IF;
      _seen := _seen || _line.variant_id;
      SELECT v.stock_quantity, v.name INTO _current, _name FROM product_variants v
      WHERE v.id = _line.variant_id AND v.business_id = _business_id AND v.product_id = _product_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Una talla no es de este producto' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF COALESCE(_current, 0) <> _line.expected THEN
      RAISE EXCEPTION 'El stock de «%» ha cambiado mientras editabas (ahora hay %). Revísalo y vuelve a guardar.',
        _name, COALESCE(_current, 0)
        USING ERRCODE = '40001';
    END IF;

    IF apply_manual_stock_change(_business_id, _product_id, _line.variant_id, _line.new_quantity, _clean_reason, _batch) <> 0 THEN
      _changed := _changed + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT _changed,
    EXISTS (SELECT 1 FROM stockagile_connections c WHERE c.business_id = _business_id AND c.enabled);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_stock_batch(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(uuid, uuid, jsonb, text) TO authenticated, service_role;

-- 4. Stock de la tienda: los ajustes que aún no han llegado a Stockagile cuentan ------------
-- (cuerpo de la 0040). Solo los ajustes (origen stock_movements): las devoluciones y compras
-- también van a la cola de Shopify y ya cuentan allí.
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
    _pending := _pending + COALESCE((
      SELECT SUM(m.quantity) FROM stockagile_stock_moves m
      WHERE m.business_id = _business_id AND m.local_variant_id = _variant_id
        AND m.source_table = 'stock_movements' AND m.status IN ('pending', 'sending', 'failed')
        AND m.location_gid IS NULL
    ), 0);
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
    _pending := _pending + COALESCE((
      SELECT SUM(m.quantity) FROM stockagile_stock_moves m
      WHERE m.business_id = _business_id AND m.local_product_id = _product_id AND m.local_variant_id IS NULL
        AND m.source_table = 'stock_movements' AND m.status IN ('pending', 'sending', 'failed')
        AND m.location_gid IS NULL
    ), 0);
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

-- 5. Reclamar movimientos: el aviso vale también para los que restan (cuerpo de la 0037) -----
CREATE OR REPLACE FUNCTION public.claim_stockagile_moves(_business_id uuid, _limit integer DEFAULT 20)
RETURNS SETOF public.stockagile_stock_moves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Un envío que no terminó puede haber llegado a Stockagile: se revisa a mano.
  UPDATE stockagile_stock_moves
  SET status = 'review',
      last_error = 'El envío no terminó: puede que ya se haya aplicado en Stockagile. Compruébalo allí.'
  WHERE business_id = _business_id AND status = 'sending' AND claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH c AS (
    SELECT m.id FROM stockagile_stock_moves m
    WHERE m.business_id = _business_id AND m.status = 'pending'
    ORDER BY m.created_at
    LIMIT GREATEST(LEAST(COALESCE(_limit, 20), 100), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE stockagile_stock_moves m
  SET status = 'sending', claimed_at = now(), attempts = m.attempts + 1
  FROM c
  WHERE m.id = c.id
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_stockagile_moves(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stockagile_moves(uuid, integer) TO service_role;

-- 6. Avisos: el movimiento de Stockagile con su signo (cuerpo de la 0037) -------------------
CREATE OR REPLACE FUNCTION public.get_shopify_problems(_business_id uuid)
RETURNS TABLE(kind text, state text, record_id uuid, reference text, error text, attempts integer, happened_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_min_role(_business_id, 'admin') OR is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un administrador puede ver los envíos a Shopify' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'venta'::text,
         CASE WHEN s.shopify_order_status = 'failed' THEN 'failed' ELSE 'retrying' END,
         s.id, s.sale_number, s.shopify_order_error, s.shopify_order_attempts, s.created_at
  FROM sales s
  WHERE s.business_id = _business_id AND s.shopify_order_gid IS NULL
    AND (s.shopify_order_status = 'failed' OR (s.shopify_order_attempts > 0 AND s.shopify_order_error IS NOT NULL))
  UNION ALL
  SELECT 'devolucion'::text,
         CASE WHEN r.shopify_refund_status = 'failed' THEN 'failed'
              WHEN s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed' THEN 'waiting'
              ELSE 'retrying' END,
         r.id, r.return_number,
         CASE WHEN s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed'
              THEN 'Esperando a que se envíe su venta ' || s.sale_number
              ELSE r.shopify_refund_error END,
         r.shopify_refund_attempts, r.created_at
  FROM sale_returns r
  JOIN sales s ON s.id = r.sale_id
  WHERE r.business_id = _business_id AND r.shopify_refund_gid IS NULL
    AND (r.shopify_refund_status = 'failed'
         OR (r.shopify_refund_attempts > 0 AND r.shopify_refund_error IS NOT NULL)
         OR (s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed'))
  UNION ALL
  SELECT 'stock'::text, 'failed', q.id,
         COALESCE(p.name || COALESCE(' · ' || v.name, ''), 'Artículo'),
         q.last_error, q.attempts, q.created_at
  FROM shopify_inventory_pushes q
  LEFT JOIN products p ON p.id = q.local_product_id
  LEFT JOIN product_variants v ON v.id = q.local_variant_id
  WHERE q.business_id = _business_id AND q.status = 'failed'
  UNION ALL
  SELECT 'aviso'::text, 'failed', e.id, e.topic, e.message, e.attempts, e.created_at
  FROM integration_webhook_events e
  WHERE e.business_id = _business_id AND e.integration_key = 'shopify' AND e.status = 'error'
  UNION ALL
  SELECT 'stockagile'::text, 'failed', m.id,
         COALESCE(p.name || COALESCE(' · ' || v.name, ''), 'Artículo')
           || ' (' || CASE WHEN m.quantity > 0 THEN '+' ELSE '' END || m.quantity || ')',
         m.last_error, m.attempts, m.created_at
  FROM stockagile_stock_moves m
  LEFT JOIN products p ON p.id = m.local_product_id
  LEFT JOIN product_variants v ON v.id = m.local_variant_id
  WHERE m.business_id = _business_id AND m.status IN ('failed', 'review')
  ORDER BY 7 DESC
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_shopify_problems(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shopify_problems(uuid) TO authenticated, service_role;
