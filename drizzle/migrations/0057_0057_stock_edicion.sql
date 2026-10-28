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
--   se guarda nada.
-- - PIN: en los negocios con dependientes con PIN (business_requires_seller), cada guardado
--   pide el PIN de quien ajusta, también a propietarios y administradores. authorize_action
--   acepta la acción 'adjust_stock' (permiso can_adjust_stock de esa persona, no de la cuenta,
--   que en el TPV es compartida) y da un pase de un solo uso de 2 minutos, que gasta
--   adjust_stock_batch. Tras 5 PIN fallidos, 5 minutos de bloqueo (verify_employee_pin, como en
--   el TPV). Sin dependientes con PIN, como hasta ahora: el permiso de la cuenta.
-- - adjust_stock (una talla): sin PIN, igual que antes; con PIN, no se puede usar.
-- - stock_movements.employee_id: quién lo hizo (la persona del PIN), además de la cuenta.
-- - recompute_local_stock: un ajuste que aún no ha llegado a Stockagile cuenta como pendiente,
--   para que un aviso de Shopify con la cifra anterior no lo deshaga.
-- - get_shopify_problems: el movimiento de Stockagile se ve con su signo ((+2) o (-1)).
-- - get_stock_movements: historial para la pantalla de stock, con el artículo y quién; lo leen
--   los miembros, como stock_movements.
-- Prueba del 28/10/2026: Stockagile acepta cantidades negativas en POST /stock/move.
-- Migración idempotente, sin secretos.

-- 0. Quién hizo cada movimiento ------------------------------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_movements_business_idx ON public.stock_movements (business_id, created_at DESC);

-- Registro de movimientos (cuerpo de la 0024 más la persona, marca app.stock_employee).
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
  _employee uuid;
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
  BEGIN
    _employee := NULLIF(current_setting('app.stock_employee', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    _employee := NULL;
  END;

  INSERT INTO stock_movements (business_id, product_id, variant_id, delta, stock_after, source, reference_id, note, created_by, employee_id)
  VALUES (NEW.business_id, _product, _variant, _delta, NEW.stock_quantity, _source, _ref,
          NULLIF(current_setting('app.stock_note', true), ''), auth.uid(), _employee);
  RETURN NULL;
END;
$$;

-- Autorizar con PIN también los ajustes de stock (cuerpo de la 0030, permisos por persona).
ALTER TABLE public.pos_authorizations DROP CONSTRAINT IF EXISTS pos_authorizations_action_check;
ALTER TABLE public.pos_authorizations ADD CONSTRAINT pos_authorizations_action_check
  CHECK (action IN ('discount', 'return', 'close_register', 'adjust_stock'));

CREATE OR REPLACE FUNCTION public.authorize_action(
  _business_id uuid,
  _employee_id uuid,
  _pin text,
  _action text,
  _amount numeric DEFAULT NULL
)
RETURNS TABLE(ok boolean, error text, locked_seconds integer, authorization_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _check record;
  _perm record;
  _allowed boolean;
  _id uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  IF _action IS NULL OR _action NOT IN ('discount', 'return', 'close_register', 'adjust_stock') THEN
    RAISE EXCEPTION 'Acción no válida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _check FROM verify_employee_pin(_business_id, _employee_id, _pin);
  IF NOT _check.ok THEN
    RETURN QUERY SELECT false, _check.error, _check.locked_seconds, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO _perm FROM employee_effective_permissions(_employee_id);
  _allowed := CASE _action
    WHEN 'discount' THEN COALESCE(_perm.max_discount_pct, 0) >= COALESCE(_amount, 100)
    WHEN 'return' THEN COALESCE(_perm.can_return, false)
    WHEN 'close_register' THEN COALESCE(_perm.can_close_register, false)
    WHEN 'adjust_stock' THEN COALESCE(_perm.can_adjust_stock, false)
  END;
  IF NOT _allowed THEN
    RETURN QUERY SELECT false, public.employee_display_name(_employee_id) || ' no tiene permiso para autorizarlo', 0, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  DELETE FROM pos_authorizations a WHERE a.business_id = _business_id AND a.expires_at < now() - interval '1 day';
  INSERT INTO pos_authorizations (business_id, action, employee_id, max_amount, requested_by)
  VALUES (_business_id, _action, _employee_id, _amount, auth.uid())
  RETURNING id INTO _id;

  RETURN QUERY SELECT true, NULL::text, 0, _id, public.employee_display_name(_employee_id);
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_action(uuid, uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_action(uuid, uuid, text, text, numeric) TO authenticated, service_role;

-- 1. Aplicar un ajuste ya validado (interna) ------------------------------------------------
-- La fila ya está bloqueada y comprobada por quien llama. Devuelve el delta.
CREATE OR REPLACE FUNCTION public.apply_manual_stock_change(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _new_quantity integer,
  _note text,
  _batch uuid,
  _employee_id uuid DEFAULT NULL
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
  PERFORM set_config('app.stock_employee', COALESCE(_employee_id::text, ''), true);
  IF _variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_quantity = _new_quantity, updated_at = now() WHERE id = _variant_id;
  ELSE
    UPDATE products SET stock_quantity = _new_quantity WHERE id = _product_id;
  END IF;
  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_note', '', true);
  PERFORM set_config('app.stock_ref', '', true);
  PERFORM set_config('app.stock_employee', '', true);

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
REVOKE ALL ON FUNCTION public.apply_manual_stock_change(uuid, uuid, uuid, integer, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- 2. Ajuste de una talla o de un producto sin tallas (cuerpo de la 0030) ---------------------
-- En un negocio con PIN no sirve: el ajuste lleva el PIN de quien lo hace (adjust_stock_batch).
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
  IF public.business_requires_seller(_business_id) THEN
    RAISE EXCEPTION 'Necesita autorización: el ajuste lleva el PIN de quien lo hace' USING ERRCODE = '42501';
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
-- Con dependientes con PIN, _authorization_id es el pase de authorize_action('adjust_stock')
-- de quien ajusta (de un solo uso, de esta cuenta y de menos de 2 minutos).
CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  _business_id uuid,
  _product_id uuid,
  _lines jsonb,
  _reason text,
  _authorization_id uuid DEFAULT NULL
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
  _employee uuid;
BEGIN
  IF public.business_requires_seller(_business_id) THEN
    -- Decide el permiso de la persona del PIN, no el de la cuenta (la del TPV es compartida).
    IF NOT public.is_member_of_business(_business_id) THEN
      RAISE EXCEPTION 'No tienes permiso para ajustar el stock' USING ERRCODE = '42501';
    END IF;
    _employee := consume_authorization(_business_id, _authorization_id, 'adjust_stock', NULL);
  ELSIF NOT public.member_can(_business_id, 'adjust_stock') THEN
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

    IF apply_manual_stock_change(_business_id, _product_id, _line.variant_id, _line.new_quantity, _clean_reason, _batch, _employee) <> 0 THEN
      _changed := _changed + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT _changed,
    EXISTS (SELECT 1 FROM stockagile_connections c WHERE c.business_id = _business_id AND c.enabled);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_stock_batch(uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(uuid, uuid, jsonb, text, uuid) TO authenticated, service_role;

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

-- 7. Historial para la pantalla de stock ---------------------------------------------------
-- Últimos movimientos del negocio (o de un producto, o de un origen), con el artículo y quién:
-- la persona del PIN o, si no hay, el nombre de la cuenta. Sin quién: Shopify, Stockagile o
-- una tarea automática. Lo leen los miembros, como stock_movements.
CREATE OR REPLACE FUNCTION public.get_stock_movements(
  _business_id uuid,
  _product_id uuid DEFAULT NULL,
  _source text DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  product_id uuid,
  product_name text,
  variant_id uuid,
  variant_name text,
  delta integer,
  stock_after integer,
  source text,
  note text,
  who text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (is_member_of_business(_business_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.created_at, s.product_id, p.name::text, s.variant_id, v.name::text, s.delta, s.stock_after,
         s.source, s.note,
         COALESCE(
           CASE WHEN s.employee_id IS NOT NULL THEN employee_display_name(s.employee_id) END,
           NULLIF(btrim(pr.full_name), ''),
           CASE WHEN s.created_by IS NOT NULL THEN 'Cuenta sin nombre' END
         )::text
  FROM stock_movements s
  LEFT JOIN products p ON p.id = s.product_id
  LEFT JOIN product_variants v ON v.id = s.variant_id
  LEFT JOIN profiles pr ON pr.id = s.created_by
  WHERE s.business_id = _business_id
    AND (_product_id IS NULL OR s.product_id = _product_id)
    AND (_source IS NULL OR s.source = _source)
  ORDER BY s.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(_limit, 50), 200), 1);
END;
$$;
REVOKE ALL ON FUNCTION public.get_stock_movements(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_movements(uuid, uuid, text, integer) TO authenticated, service_role;