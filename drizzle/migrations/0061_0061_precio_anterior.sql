-- Precio anterior de Shopify (`compareAtPrice`) en el TPV y en el ticket (plan aprobado el 2026-11-10).
-- - La sincronización de Shopify lo guarda por talla (y por producto, si tiene una sola). Solo si
--   es mayor que el precio: si no, vacío, así se borra solo al acabar la promoción.
-- - Cada línea de venta guarda el de ese momento, para el duplicado del ticket. Lo pone un
--   trigger con el dato del catálogo, nunca el que mande el TPV, y solo si es mayor que el
--   precio de la línea. No cambia nada de lo cobrado: total, descuento, IVA ni stock.
-- - Columnas nuevas en tablas con coste oculto (0052): cada una con su GRANT SELECT.

-- 1. Columnas -----------------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2);
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS compare_at_price numeric(12,2);

GRANT SELECT (compare_at_price) ON public.products TO authenticated, anon;
GRANT SELECT (compare_at_price) ON public.product_variants TO authenticated, anon;
GRANT SELECT (compare_at_price) ON public.sale_items TO authenticated, anon;

-- 2. Precio anterior de cada línea al vender (interna) ---------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_item_compare_at_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _compare numeric;
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    SELECT v.compare_at_price INTO _compare FROM product_variants v WHERE v.id = NEW.variant_id;
  ELSIF NEW.product_id IS NOT NULL THEN
    SELECT p.compare_at_price INTO _compare FROM products p WHERE p.id = NEW.product_id;
  END IF;
  NEW.compare_at_price := CASE WHEN _compare > NEW.unit_price THEN _compare END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sale_item_compare_at_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_item_compare_at_price ON public.sale_items;
CREATE TRIGGER trg_sale_item_compare_at_price
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.sale_item_compare_at_price();
