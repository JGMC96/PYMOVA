-- Corrige set_purchase_order_status: al aplicar la 0040 se duplicó «updated_at = now()» en la
-- rama de cancelar, y Postgres no admite asignar dos veces la misma columna (cancelar una
-- compra daba error). Vuelve a crear la función tal como iba en la PR #48. Nada más cambia.
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
