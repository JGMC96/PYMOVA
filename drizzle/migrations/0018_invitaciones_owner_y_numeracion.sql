-- A8 · Solo un owner (o el super admin) puede invitar como owner.
-- A7 · Numeración correlativa y atómica de ventas, devoluciones, facturas y
--      pedidos online: contadores en business_settings con bloqueo de fila,
--      índices únicos y números de documento inmutables.
-- Migración idempotente. La siembra de contadores lleva la marca de sesión
-- app.counter_update para pasar el trigger de protección si se vuelve a aplicar.

SELECT set_config('app.counter_update', '1', false);

-- 1. A8 · Invitaciones ---------------------------------------------------------
DROP POLICY IF EXISTS "Admins can create invitations" ON public.business_invitations;
CREATE POLICY "Admins can create invitations"
ON public.business_invitations FOR INSERT
TO authenticated
WITH CHECK (
  (public.has_min_role(business_id, 'admin'::app_role) OR public.is_super_admin())
  AND invited_by = auth.uid()
  AND (role <> 'owner'::app_role OR public.has_business_role(business_id, 'owner'::app_role) OR public.is_super_admin())
);

-- Subir una invitación a owner solo lo puede hacer un owner; revocarla, cualquier admin.
CREATE OR REPLACE FUNCTION public.protect_invitation_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'owner'::app_role AND OLD.role IS DISTINCT FROM 'owner'::app_role
     AND NOT (public.has_business_role(NEW.business_id, 'owner'::app_role) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un propietario puede invitar como propietario' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_invitation_role ON public.business_invitations;
CREATE TRIGGER trg_protect_invitation_role
BEFORE UPDATE ON public.business_invitations
FOR EACH ROW EXECUTE FUNCTION public.protect_invitation_role();

CREATE OR REPLACE FUNCTION public.accept_business_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _inv business_invitations%ROWTYPE;
  _email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para aceptar la invitación';
  END IF;

  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = auth.uid();

  SELECT * INTO _inv
  FROM public.business_invitations
  WHERE token = _token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitación no encontrada';
  END IF;

  -- Idempotent: already accepted by this same user (double click / re-open link)
  IF _inv.status = 'accepted' AND _inv.accepted_by = auth.uid() THEN
    RETURN _inv.business_id;
  END IF;

  -- Already a member of that business: nothing to do
  IF EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _inv.business_id AND bm.user_id = auth.uid() AND bm.is_active
  ) AND lower(_inv.email) = _email THEN
    RETURN _inv.business_id;
  END IF;

  IF _inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta invitación ya no está disponible';
  END IF;

  IF _inv.expires_at < now() THEN
    RAISE EXCEPTION 'La invitación ha caducado';
  END IF;

  IF lower(_inv.email) <> _email THEN
    RAISE EXCEPTION 'Esta invitación pertenece a otro correo electrónico';
  END IF;

  -- Una invitación como owner solo vale si la hizo un owner del negocio o el super admin.
  IF _inv.role = 'owner'::app_role AND NOT (
    EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _inv.business_id AND bm.user_id = _inv.invited_by
        AND bm.role = 'owner'::app_role AND bm.is_active
    )
    OR EXISTS (
      SELECT 1 FROM public.platform_roles pr
      WHERE pr.user_id = _inv.invited_by AND pr.role = 'super_admin'::platform_role
    )
  ) THEN
    RAISE EXCEPTION 'Esta invitación no es válida: solo un propietario puede invitar como propietario' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.business_members (business_id, user_id, role, is_active, joined_at)
  VALUES (_inv.business_id, auth.uid(), _inv.role, true, now())
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = true, joined_at = COALESCE(business_members.joined_at, now());

  UPDATE public.business_invitations
  SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), updated_at = now()
  WHERE id = _inv.id;

  RETURN _inv.business_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_business_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(text) TO authenticated;

-- 2. A7 · Contadores en business_settings --------------------------------------
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS next_sale_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS next_return_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS next_online_order_number integer NOT NULL DEFAULT 1;

-- Todos los negocios tienen fila de ajustes
INSERT INTO public.business_settings (business_id)
SELECT b.id FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.business_settings bs WHERE bs.business_id = b.id);

-- Siembra: continuar la serie de los documentos que ya existen (nunca retrocede)
UPDATE public.business_settings bs
SET next_sale_number = GREATEST(bs.next_sale_number, s.m + 1)
FROM (
  SELECT business_id, MAX(CASE WHEN sale_number ~ '^VTA-[0-9]+$' THEN substring(sale_number FROM 5)::integer ELSE 0 END) AS m
  FROM public.sales GROUP BY business_id
) s
WHERE s.business_id = bs.business_id;

UPDATE public.business_settings bs
SET next_return_number = GREATEST(bs.next_return_number, r.m + 1)
FROM (
  SELECT business_id, MAX(CASE WHEN return_number ~ '^DEV-[0-9]+$' THEN substring(return_number FROM 5)::integer ELSE 0 END) AS m
  FROM public.sale_returns GROUP BY business_id
) r
WHERE r.business_id = bs.business_id;

UPDATE public.business_settings bs
SET next_online_order_number = GREATEST(bs.next_online_order_number, o.m + 1)
FROM (
  SELECT business_id, COALESCE(MAX(NULLIF(regexp_replace(order_number, '\D', '', 'g'), '')::integer), 0) AS m
  FROM public.online_orders GROUP BY business_id
) o
WHERE o.business_id = bs.business_id;

-- Siguiente número de una serie, con bloqueo de fila (solo la usan las RPC)
CREATE OR REPLACE FUNCTION public.next_document_number(_business_id uuid, _kind text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF _kind NOT IN ('sale', 'return', 'online_order', 'invoice') THEN
    RAISE EXCEPTION 'Serie desconocida: %', _kind;
  END IF;

  INSERT INTO business_settings (business_id) VALUES (_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  PERFORM set_config('app.counter_update', '1', true);
  EXECUTE format(
    'UPDATE business_settings SET next_%1$s_number = next_%1$s_number + 1, updated_at = now() WHERE business_id = $1 RETURNING next_%1$s_number - 1',
    _kind
  ) INTO _n USING _business_id;
  PERFORM set_config('app.counter_update', '', true);

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

-- Los contadores no se editan desde el cliente
CREATE OR REPLACE FUNCTION public.protect_document_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.next_invoice_number, NEW.next_sale_number, NEW.next_return_number, NEW.next_online_order_number)
     IS DISTINCT FROM
     (OLD.next_invoice_number, OLD.next_sale_number, OLD.next_return_number, OLD.next_online_order_number)
     AND COALESCE(current_setting('app.counter_update', true), '') <> '1' THEN
    RAISE EXCEPTION 'Los contadores de numeración no se pueden editar' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_document_counters ON public.business_settings;
CREATE TRIGGER trg_protect_document_counters
BEFORE UPDATE ON public.business_settings
FOR EACH ROW EXECUTE FUNCTION public.protect_document_counters();

-- 3. A7 · Generadores de número -------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_sale_number(_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para generar ventas en este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN 'VTA-' || LPAD(next_document_number(_business_id, 'sale')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_invoice_number(_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prefix text;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para generar facturas en este negocio' USING ERRCODE = '42501';
  END IF;
  INSERT INTO business_settings (business_id) VALUES (_business_id) ON CONFLICT (business_id) DO NOTHING;
  SELECT COALESCE(invoice_prefix, 'FAC-') INTO _prefix FROM business_settings WHERE business_id = _business_id;
  RETURN _prefix || LPAD(next_document_number(_business_id, 'invoice')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_online_order_number(_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_member_of_business(_business_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para generar pedidos en este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN 'WEB-' || LPAD(next_document_number(_business_id, 'online_order')::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_sale_number(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_invoice_number(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_online_order_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_sale_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_online_order_number(uuid) TO authenticated, service_role;

-- create_sale_return: mismo cuerpo que dz/0009, con el número del contador
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
  _total numeric := 0;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones en este negocio' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = _sale_id AND s.business_id = _business_id) THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una línea a devolver';
  END IF;

  _number := 'DEV-' || LPAD(next_document_number(_business_id, 'return')::text, 6, '0');

  INSERT INTO sale_returns (business_id, sale_id, return_number, reason, refund_method, restock, created_by)
  VALUES (_business_id, _sale_id, _number, _reason, _refund_method, COALESCE(_restock, true), auth.uid())
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
    SELECT COALESCE(SUM(ri.quantity), 0) INTO _already
    FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = _sale_item.id AND r.id <> _return_id;
    IF _already + _qty > _sale_item.quantity THEN
      RAISE EXCEPTION 'No puedes devolver más unidades de "%" de las vendidas (% pendientes)',
        _sale_item.product_name, _sale_item.quantity - _already;
    END IF;
    INSERT INTO sale_return_items (
      return_id, sale_item_id, product_id, variant_id, product_name, quantity, unit_price, total, unit_cost
    ) VALUES (
      _return_id, _sale_item.id, _sale_item.product_id, _sale_item.variant_id,
      _sale_item.product_name, _qty, _sale_item.unit_price,
      ROUND(_qty * _sale_item.unit_price, 2), _sale_item.unit_cost
    );
    _total := _total + ROUND(_qty * _sale_item.unit_price, 2);
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

-- 4. A7 · Números inmutables e únicos ---------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_document_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _col text := CASE TG_TABLE_NAME
    WHEN 'sales' THEN 'sale_number'
    WHEN 'invoices' THEN 'invoice_number'
    WHEN 'sale_returns' THEN 'return_number'
  END;
BEGIN
  IF to_jsonb(NEW)->>_col IS DISTINCT FROM to_jsonb(OLD)->>_col THEN
    RAISE EXCEPTION 'El número de documento no se puede modificar' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_sale_number ON public.sales;
CREATE TRIGGER trg_protect_sale_number BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.protect_document_number();
DROP TRIGGER IF EXISTS trg_protect_invoice_number ON public.invoices;
CREATE TRIGGER trg_protect_invoice_number BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.protect_document_number();
DROP TRIGGER IF EXISTS trg_protect_return_number ON public.sale_returns;
CREATE TRIGGER trg_protect_return_number BEFORE UPDATE ON public.sale_returns
FOR EACH ROW EXECUTE FUNCTION public.protect_document_number();

CREATE UNIQUE INDEX IF NOT EXISTS sales_business_sale_number_key ON public.sales (business_id, sale_number);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_invoice_number_key ON public.invoices (business_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_business_return_number_key ON public.sale_returns (business_id, return_number);

-- 5. Las facturas solo nacen con create_invoice_with_items ----------------------
DROP POLICY IF EXISTS "Members can create invoices" ON public.invoices;

SELECT set_config('app.counter_update', '', false);
