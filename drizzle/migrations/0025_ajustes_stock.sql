-- Ajustes manuales de stock (A12, segunda parte).
-- - adjust_stock: solo admins, con motivo; queda en stock_movements (origen 'manual')
--   y el delta se manda a Shopify por la cola.
-- - Desde el cliente no se puede cambiar stock_quantity escribiendo en las tablas.
--   Las ventas, devoluciones, pedidos y Shopify lo mueven con funciones SECURITY DEFINER.
-- - Crear un producto o variante con stock inicial distinto de 0: solo admins.
-- Migración idempotente.

-- 1. Protección del stock frente a escrituras directas ---------------------------
-- SECURITY INVOKER: en una escritura directa desde la API current_user es
-- 'authenticated'; dentro de las funciones SECURITY DEFINER es su dueño.
CREATE OR REPLACE FUNCTION public.protect_stock_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
      RAISE EXCEPTION 'El stock se cambia con un ajuste de stock (con motivo) o con ventas y devoluciones'
        USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(NEW.stock_quantity, 0) <> 0
        AND NOT (public.has_min_role(NEW.business_id, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un administrador puede dar de alta artículos con stock inicial'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_stock_products ON public.products;
CREATE TRIGGER trg_protect_stock_products
BEFORE INSERT OR UPDATE OF stock_quantity ON public.products
FOR EACH ROW EXECUTE FUNCTION public.protect_stock_quantity();

DROP TRIGGER IF EXISTS trg_protect_stock_variants ON public.product_variants;
CREATE TRIGGER trg_protect_stock_variants
BEFORE INSERT OR UPDATE OF stock_quantity ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.protect_stock_quantity();

-- 2. Ajuste manual -----------------------------------------------------------------
-- Fija la cantidad nueva de una variante, o de un producto sin variantes. Devuelve el delta.
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
  _current integer;
  _product uuid;
  _delta integer;
BEGIN
  IF NOT (public.has_min_role(_business_id, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un administrador puede ajustar el stock' USING ERRCODE = '42501';
  END IF;
  IF length(_clean_reason) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo del ajuste' USING ERRCODE = '22023';
  END IF;
  IF _new_quantity IS NULL OR _new_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa' USING ERRCODE = '22023';
  END IF;

  IF _variant_id IS NOT NULL THEN
    SELECT v.stock_quantity, v.product_id INTO _current, _product
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
    SELECT p.stock_quantity INTO _current FROM products p
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

  _delta := _new_quantity - COALESCE(_current, 0);
  IF _delta = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.stock_source', 'manual', true);
  PERFORM set_config('app.stock_note', _clean_reason, true);
  IF _variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_quantity = _new_quantity, updated_at = now() WHERE id = _variant_id;
  ELSE
    UPDATE products SET stock_quantity = _new_quantity WHERE id = _product;
  END IF;
  PERFORM set_config('app.stock_source', '', true);
  PERFORM set_config('app.stock_note', '', true);

  -- A Shopify por la cola (si el artículo no está emparejado, el envío queda 'skipped').
  PERFORM enqueue_shopify_inventory_push(
    _business_id, _product, _variant_id, _delta, 'adjustment', 'stock_movements', NULL
  );

  RETURN _delta;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text) TO authenticated, service_role;
