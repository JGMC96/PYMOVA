-- Facturas y cobros blindados (repaso del tema «Facturas, cobros y clientes», 23/10/2026).
--
-- · Solo los administradores (y el propietario) ven facturas, líneas y cobros; el personal ya
--   no los lee por la API. El super admin los sigue viendo.
-- · Nadie borra ni edita a mano una factura, sus líneas o un cobro, tampoco el super admin:
--   una factura emitida conserva su número y su contenido (numeración correlativa). Borrar el
--   negocio entero sigue borrando sus facturas (cascada de la clave ajena).
-- · El estado cambia con set_invoice_status (emitir o anular); «pagada» y «vencida» salen de
--   los cobros. Un cobro mal metido se anula con delete_payment_and_recalc_invoice, que
--   recalcula la factura (el borrado queda en audit_logs).
-- · create_payment_and_recalc_invoice no deja cobrar más de lo pendiente.
-- · create_invoice_with_items comprueba que cada producto es del negocio y que las líneas
--   tienen descripción, cantidad mayor que cero y precio no negativo.

-- 1. Lectura: solo administradores ----------------------------------------------------------
DROP POLICY IF EXISTS "Members can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins can view invoices" ON public.invoices;
CREATE POLICY "Admins can view invoices" ON public.invoices
  FOR SELECT TO authenticated USING (public.has_min_role(business_id, 'admin'));

DROP POLICY IF EXISTS "Members can view invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins can view invoice items" ON public.invoice_items;
CREATE POLICY "Admins can view invoice items" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_min_role(i.business_id, 'admin')));

DROP POLICY IF EXISTS "Members can view payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can view payments" ON public.payments;
CREATE POLICY "Admins can view payments" ON public.payments
  FOR SELECT TO authenticated USING (public.has_min_role(business_id, 'admin'));

-- 2. Sin escrituras directas: todo por RPC --------------------------------------------------
DROP POLICY IF EXISTS "Admins can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Owner/Admin can delete invoices" ON public.invoices;
DROP POLICY IF EXISTS "Super admins can update all invoices" ON public.invoices;
DROP POLICY IF EXISTS "Super admins can delete all invoices" ON public.invoices;

DROP POLICY IF EXISTS "Admins can insert invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins can update invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Owner/Admin can delete invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Super admins can manage all invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Super admins can view all invoice items" ON public.invoice_items;
CREATE POLICY "Super admins can view all invoice items" ON public.invoice_items
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "Admins can create payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
DROP POLICY IF EXISTS "Owner/Admin can delete payments" ON public.payments;
DROP POLICY IF EXISTS "Super admins can update all payments" ON public.payments;
DROP POLICY IF EXISTS "Super admins can delete all payments" ON public.payments;

-- Segunda barrera: sin permisos de escritura sobre las tablas (las RPC son SECURITY DEFINER).
REVOKE ALL ON TABLE public.invoices, public.invoice_items, public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.invoices, public.invoice_items, public.payments FROM authenticated;

-- 3. Estado de la factura: emitir o anular --------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_invoice_status(
  _business_id uuid,
  _invoice_id uuid,
  _status invoice_status
)
RETURNS invoice_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invoice invoices%ROWTYPE;
  _new invoice_status := _status;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el estado de una factura' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _invoice FROM invoices
  WHERE id = _invoice_id AND business_id = _business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada' USING ERRCODE = '22023';
  END IF;

  IF _status IN ('paid', 'overdue') THEN
    RAISE EXCEPTION '«Pagada» y «vencida» no se ponen a mano: salen de los cobros' USING ERRCODE = '22023';
  END IF;

  IF _invoice.status = _status THEN
    RETURN _invoice.status;
  END IF;

  IF _status = 'sent' THEN
    IF _invoice.status <> 'draft' THEN
      RAISE EXCEPTION 'Solo se emite una factura en borrador' USING ERRCODE = '22023';
    END IF;
    IF _invoice.due_date IS NOT NULL AND _invoice.due_date < CURRENT_DATE THEN
      _new := 'overdue';
    END IF;
  ELSIF _status = 'cancelled' THEN
    IF _invoice.status NOT IN ('draft', 'sent', 'overdue') THEN
      RAISE EXCEPTION 'Esta factura no se puede anular' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = _invoice_id) THEN
      RAISE EXCEPTION 'La factura tiene cobros: anúlalos antes de anular la factura' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Volver a borrador no se permite: la factura ya tiene número.
    RAISE EXCEPTION 'Cambio de estado no permitido' USING ERRCODE = '22023';
  END IF;

  UPDATE invoices SET status = _new, updated_at = now()
  WHERE id = _invoice_id AND business_id = _business_id;
  RETURN _new;
END;
$$;
REVOKE ALL ON FUNCTION public.set_invoice_status(uuid, uuid, invoice_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_status(uuid, uuid, invoice_status) TO authenticated, service_role;

-- 4. Registrar un cobro: como antes, sin pasar de lo pendiente -------------------------------
CREATE OR REPLACE FUNCTION public.create_payment_and_recalc_invoice(
  _business_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _payment_method text DEFAULT NULL,
  _payment_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _payment_id uuid;
  _invoice invoices%ROWTYPE;
  _already_paid numeric;
  _total_paid numeric;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar cobros' USING ERRCODE = '42501';
  END IF;

  -- Bloquea la factura para que dos cobros a la vez no la descuadren.
  SELECT * INTO _invoice FROM invoices
  WHERE id = _invoice_id AND business_id = _business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada' USING ERRCODE = '22023';
  END IF;

  IF _invoice.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en facturas borrador o canceladas' USING ERRCODE = '22023';
  END IF;

  _amount := ROUND(_amount, 2);
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO _already_paid
  FROM payments WHERE invoice_id = _invoice_id AND business_id = _business_id;
  IF _already_paid + _amount > _invoice.total THEN
    RAISE EXCEPTION 'El cobro supera lo pendiente de la factura (%)', GREATEST(_invoice.total - _already_paid, 0)
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO payments (business_id, invoice_id, amount, payment_method, payment_date, notes, created_by)
  VALUES (_business_id, _invoice_id, _amount, _payment_method, COALESCE(_payment_date, CURRENT_DATE), _notes, auth.uid())
  RETURNING id INTO _payment_id;

  _total_paid := _already_paid + _amount;

  -- Pagada si cubre el total; si no, vencida (si ya lo estaba o pasó la fecha) o enviada.
  IF _total_paid >= _invoice.total THEN
    UPDATE invoices SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = _invoice_id AND business_id = _business_id AND status <> 'paid';
  ELSIF _invoice.status = 'overdue' THEN
    NULL;
  ELSIF _invoice.due_date IS NOT NULL AND _invoice.due_date < CURRENT_DATE THEN
    UPDATE invoices SET status = 'overdue', updated_at = now()
    WHERE id = _invoice_id AND business_id = _business_id;
  END IF;

  RETURN _payment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_payment_and_recalc_invoice(uuid, uuid, numeric, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_and_recalc_invoice(uuid, uuid, numeric, text, date, text) TO authenticated, service_role;

-- 5. Anular un cobro y recalcular la factura ----------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_payment_and_recalc_invoice(
  _business_id uuid,
  _payment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invoice_id uuid;
  _invoice invoices%ROWTYPE;
  _total_paid numeric;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede anular cobros' USING ERRCODE = '42501';
  END IF;

  SELECT p.invoice_id INTO _invoice_id FROM payments p
  WHERE p.id = _payment_id AND p.business_id = _business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado' USING ERRCODE = '22023';
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT * INTO _invoice FROM invoices
    WHERE id = _invoice_id AND business_id = _business_id
    FOR UPDATE;
  END IF;

  DELETE FROM payments WHERE id = _payment_id AND business_id = _business_id;

  IF _invoice_id IS NOT NULL AND _invoice.status = 'paid' THEN
    SELECT COALESCE(SUM(amount), 0) INTO _total_paid
    FROM payments WHERE invoice_id = _invoice_id AND business_id = _business_id;
    IF _total_paid < _invoice.total THEN
      UPDATE invoices
      SET status = CASE WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE
                        THEN 'overdue'::invoice_status ELSE 'sent'::invoice_status END,
          paid_at = NULL,
          updated_at = now()
      WHERE id = _invoice_id AND business_id = _business_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_payment_and_recalc_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payment_and_recalc_invoice(uuid, uuid) TO authenticated, service_role;

-- 6. Crear factura: líneas válidas y productos del negocio --------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_with_items(
  _business_id uuid,
  _client_id uuid,
  _items jsonb,
  _due_date date DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS TABLE(invoice_id uuid, invoice_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invoice_number text;
  _invoice_id uuid;
  _tax_rate numeric;
  _subtotal numeric;
  _tax numeric;
  _total numeric := 0;
  _item jsonb;
  _product_id uuid;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede crear facturas' USING ERRCODE = '42501';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'La factura debe tener al menos una línea' USING ERRCODE = '22023';
  END IF;

  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients
    WHERE id = _client_id AND business_id = _business_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  -- Cada línea: descripción, cantidad > 0, precio >= 0 y, si lleva producto, que sea del negocio.
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF btrim(COALESCE(_item->>'description', '')) = '' THEN
      RAISE EXCEPTION 'Cada línea necesita una descripción' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada línea debe ser mayor que 0' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((_item->>'unit_price')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'El precio de una línea no puede ser negativo' USING ERRCODE = '22023';
    END IF;
    _product_id := NULLIF(NULLIF(_item->>'product_id', ''), 'null')::uuid;
    IF _product_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM products WHERE id = _product_id AND business_id = _business_id
    ) THEN
      RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE = '42501';
    END IF;
    _total := _total + ROUND((_item->>'quantity')::numeric * COALESCE((_item->>'unit_price')::numeric, 0), 2);
  END LOOP;

  SELECT COALESCE(bs.tax_rate, 21) INTO _tax_rate FROM business_settings bs WHERE bs.business_id = _business_id;
  IF NOT FOUND THEN _tax_rate := 21; END IF;

  -- Numeración correlativa (contador con bloqueo, dz/0018)
  _invoice_number := generate_invoice_number(_business_id);

  -- IVA incluido: el total es la suma de las líneas; base y cuota se deducen de él.
  _total := ROUND(_total, 2);
  _subtotal := ROUND(_total / (1 + _tax_rate / 100), 2);
  _tax := ROUND(_total - _subtotal, 2);

  INSERT INTO invoices (
    business_id, client_id, invoice_number, status, subtotal, tax, total, due_date, notes, created_by
  ) VALUES (
    _business_id, _client_id, _invoice_number, 'draft', _subtotal, _tax, _total, _due_date, _notes, auth.uid()
  )
  RETURNING id INTO _invoice_id;

  INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, total)
  SELECT
    _invoice_id,
    NULLIF(NULLIF(item->>'product_id', ''), 'null')::uuid,
    btrim(item->>'description'),
    (item->>'quantity')::numeric,
    COALESCE((item->>'unit_price')::numeric, 0),
    ROUND((item->>'quantity')::numeric * COALESCE((item->>'unit_price')::numeric, 0), 2)
  FROM jsonb_array_elements(_items) AS item;

  RETURN QUERY SELECT _invoice_id, _invoice_number;
END;
$$;
REVOKE ALL ON FUNCTION public.create_invoice_with_items(uuid, uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_items(uuid, uuid, jsonb, date, text) TO authenticated, service_role;
