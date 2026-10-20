-- Revisión de seguridad del 20/10/2026 (docs/AUDITORIA.md, «Revisión de seguridad»).
-- 1. Una invitación solo se puede revocar desde el cliente: no se puede mover a otro
--    negocio, cambiar quién invitó, el correo, el rol ni reactivarla.
-- 2. Una devolución no puede repetir la misma línea de venta.
-- 3. La fila de ajustes del negocio no se puede borrar ni crear desde el cliente
--    (así no se esquiva la protección de los contadores de numeración).
-- Migración idempotente.

-- 1. Invitaciones ------------------------------------------------------------------
-- SECURITY INVOKER: en una escritura directa desde la API current_user es
-- 'authenticated'; dentro de accept_business_invitation (SECURITY DEFINER) es el
-- dueño de la función, que sí puede marcarla como aceptada.
CREATE OR REPLACE FUNCTION public.protect_invitation_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Subir una invitación a owner solo lo puede hacer un owner (o el super admin).
  IF NEW.role = 'owner'::app_role AND OLD.role IS DISTINCT FROM 'owner'::app_role
     AND NOT (public.has_business_role(NEW.business_id, 'owner'::app_role) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un propietario puede invitar como propietario' USING ERRCODE = '42501';
  END IF;

  -- Desde el cliente, lo único que se puede hacer con una invitación es revocarla.
  IF current_user IN ('authenticated', 'anon') THEN
    IF (NEW.id, NEW.business_id, NEW.email, NEW.role, NEW.invited_by, NEW.token,
        NEW.expires_at, NEW.accepted_by, NEW.accepted_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.business_id, OLD.email, OLD.role, OLD.invited_by, OLD.token,
        OLD.expires_at, OLD.accepted_by, OLD.accepted_at, OLD.created_at)
       OR (NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'pending' AND NEW.status = 'revoked')) THEN
      RAISE EXCEPTION 'Una invitación solo se puede revocar' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_invitation_role ON public.business_invitations;
CREATE TRIGGER trg_protect_invitation_role
BEFORE UPDATE ON public.business_invitations
FOR EACH ROW EXECUTE FUNCTION public.protect_invitation_role();

-- 2. Devoluciones sin líneas repetidas -----------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS sale_return_items_return_line_key
  ON public.sale_return_items (return_id, sale_item_id);

-- Cuerpo de la 0021; cambian la comprobación de líneas repetidas y el cálculo de _already.
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
  UPDATE sale_returns sr SET total = _total WHERE sr.id = _return_id;
  RETURN QUERY SELECT _return_id, _number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, boolean) TO authenticated, service_role;

-- 3. Ajustes del negocio: el cliente solo los lee y los actualiza -----------------------
DROP POLICY IF EXISTS "Owner/Admin can manage settings" ON public.business_settings;
DROP POLICY IF EXISTS "Owner/Admin can update settings" ON public.business_settings;
CREATE POLICY "Owner/Admin can update settings"
ON public.business_settings FOR UPDATE TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

REVOKE ALL ON public.business_settings FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.business_settings FROM authenticated;
GRANT SELECT, UPDATE ON public.business_settings TO authenticated;
