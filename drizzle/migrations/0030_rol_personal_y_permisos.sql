-- El rol «personal» de verdad y permisos por persona de catálogo (fase 2B, cierra M3).
-- - Permisos por persona nuevos: cambiar productos y precios (can_edit_catalog), ver costes
--   (can_see_costs) y ajustar stock (can_adjust_stock). Por defecto sí para propietarios y
--   administradores, no para el personal. Los da solo el propietario.
-- - Con cuenta, los permisos son los de la persona de esa cuenta (member_can). Una cuenta
--   «personal» sin permisos solo vende y consulta.
-- - Productos y variantes: solo con can_edit_catalog (trigger para las escrituras desde el
--   cliente; las RPC y las sincronizaciones no pasan por él).
-- - Clientes, facturas, líneas y cobros: escribir solo administradores (y propietarios).
-- - Panel de inicio (métricas y actividad): solo administradores.
-- - RR. HH.: fichajes, jornadas, ausencias y permisos de otros, solo administradores; cada
--   uno ve los suyos.
-- - Equipo: un administrador solo gestiona e invita a personal; no se toca a sí mismo ni a
--   otros administradores. El correo de los demás, solo para administradores.
-- Migración idempotente, sin secretos.

-- 1. Permisos de catálogo por persona ---------------------------------------------------
ALTER TABLE public.hr_employee_permissions
  ADD COLUMN IF NOT EXISTS can_edit_catalog boolean,
  ADD COLUMN IF NOT EXISTS can_see_costs boolean,
  ADD COLUMN IF NOT EXISTS can_adjust_stock boolean;

-- Permisos efectivos (interna). Sin valor propio, los del rol de la cuenta.
DROP FUNCTION IF EXISTS public.employee_effective_permissions(uuid);
CREATE FUNCTION public.employee_effective_permissions(_employee_id uuid)
RETURNS TABLE(
  is_owner boolean,
  max_discount_pct numeric,
  can_return boolean,
  can_close_register boolean,
  can_edit_catalog boolean,
  can_see_costs boolean,
  can_adjust_stock boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(m.role = 'owner', false),
    CASE WHEN m.role = 'owner' THEN 100::numeric
         ELSE COALESCE(p.max_discount_pct, CASE WHEN m.role = 'admin' THEN 100 ELSE 10 END)::numeric END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_return, m.role = 'admin', false) END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_close_register, m.role = 'admin', false) END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_edit_catalog, m.role = 'admin', false) END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_see_costs, m.role = 'admin', false) END,
    CASE WHEN m.role = 'owner' THEN true ELSE COALESCE(p.can_adjust_stock, m.role = 'admin', false) END
  FROM hr_employees e
  LEFT JOIN business_members m ON m.business_id = e.business_id AND m.user_id = e.user_id AND m.is_active
  LEFT JOIN hr_employee_permissions p ON p.employee_id = e.id
  WHERE e.id = _employee_id;
$$;
REVOKE ALL ON FUNCTION public.employee_effective_permissions(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_pos_permissions(uuid);
CREATE FUNCTION public.get_pos_permissions(_business_id uuid)
RETURNS TABLE(
  employee_id uuid,
  name text,
  is_owner boolean,
  has_account boolean,
  customized boolean,
  max_discount_pct numeric,
  can_return boolean,
  can_close_register boolean,
  can_edit_catalog boolean,
  can_see_costs boolean,
  can_adjust_stock boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id,
         public.employee_display_name(e.id),
         ep.is_owner,
         e.user_id IS NOT NULL,
         EXISTS (SELECT 1 FROM hr_employee_permissions p WHERE p.employee_id = e.id),
         ep.max_discount_pct,
         ep.can_return,
         ep.can_close_register,
         ep.can_edit_catalog,
         ep.can_see_costs,
         ep.can_adjust_stock
  FROM hr_employees e
  CROSS JOIN LATERAL public.employee_effective_permissions(e.id) ep
  WHERE e.business_id = _business_id AND e.is_active AND is_member_of_business(_business_id)
  ORDER BY ep.is_owner DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.get_pos_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_permissions(uuid) TO authenticated, service_role;

-- Solo el propietario cambia permisos, y nunca los de un propietario.
DROP FUNCTION IF EXISTS public.set_employee_permissions(uuid, uuid, numeric, boolean, boolean);
CREATE OR REPLACE FUNCTION public.set_employee_permissions(
  _business_id uuid,
  _employee_id uuid,
  _max_discount_pct numeric,
  _can_return boolean,
  _can_close_register boolean,
  _can_edit_catalog boolean DEFAULT false,
  _can_see_costs boolean DEFAULT false,
  _can_adjust_stock boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _is_owner boolean;
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede cambiar los permisos' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hr_employees e WHERE e.id = _employee_id AND e.business_id = _business_id) THEN
    RAISE EXCEPTION 'La persona no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;
  SELECT p.is_owner INTO _is_owner FROM employee_effective_permissions(_employee_id) p;
  IF _is_owner THEN
    RAISE EXCEPTION 'Los permisos de un propietario no se pueden cambiar' USING ERRCODE = '22023';
  END IF;
  IF _max_discount_pct IS NULL OR _max_discount_pct < 0 OR _max_discount_pct > 100 THEN
    RAISE EXCEPTION 'El descuento máximo debe estar entre 0 y 100' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hr_employee_permissions (
    business_id, employee_id, max_discount_pct, can_return, can_close_register,
    can_edit_catalog, can_see_costs, can_adjust_stock, updated_by
  ) VALUES (
    _business_id, _employee_id, ROUND(_max_discount_pct, 2), COALESCE(_can_return, false), COALESCE(_can_close_register, false),
    COALESCE(_can_edit_catalog, false), COALESCE(_can_see_costs, false), COALESCE(_can_adjust_stock, false), auth.uid()
  )
  ON CONFLICT (employee_id) DO UPDATE
    SET max_discount_pct = EXCLUDED.max_discount_pct,
        can_return = EXCLUDED.can_return,
        can_close_register = EXCLUDED.can_close_register,
        can_edit_catalog = EXCLUDED.can_edit_catalog,
        can_see_costs = EXCLUDED.can_see_costs,
        can_adjust_stock = EXCLUDED.can_adjust_stock,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_employee_permissions(uuid, uuid, numeric, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_permissions(uuid, uuid, numeric, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- 2. Permisos de la cuenta que llama (las escrituras desde la app de gestión) ----------
-- Propietario y super admin: todo. Con persona en RR. HH.: sus permisos. Sin ella: el rol.
CREATE OR REPLACE FUNCTION public.member_can(_business_id uuid, _perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role app_role;
  _employee_id uuid;
  _p record;
BEGIN
  IF is_super_admin() THEN
    RETURN true;
  END IF;
  SELECT m.role INTO _role FROM business_members m
  WHERE m.business_id = _business_id AND m.user_id = auth.uid() AND m.is_active;
  IF _role IS NULL THEN
    RETURN false;
  END IF;
  IF _role = 'owner' THEN
    RETURN true;
  END IF;
  SELECT e.id INTO _employee_id FROM hr_employees e
  WHERE e.business_id = _business_id AND e.user_id = auth.uid()
  LIMIT 1;
  IF _employee_id IS NULL THEN
    RETURN _role = 'admin';
  END IF;
  SELECT * INTO _p FROM employee_effective_permissions(_employee_id);
  RETURN COALESCE(CASE _perm
    WHEN 'edit_catalog' THEN _p.can_edit_catalog
    WHEN 'see_costs' THEN _p.can_see_costs
    WHEN 'adjust_stock' THEN _p.can_adjust_stock
  END, false);
END;
$$;
REVOKE ALL ON FUNCTION public.member_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_can(uuid, text) TO authenticated, service_role;

-- Para la app: qué puede hacer la cuenta con la sesión abierta.
CREATE OR REPLACE FUNCTION public.get_my_permissions(_business_id uuid)
RETURNS TABLE(can_edit_catalog boolean, can_see_costs boolean, can_adjust_stock boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.member_can(_business_id, 'edit_catalog'),
         public.member_can(_business_id, 'see_costs'),
         public.member_can(_business_id, 'adjust_stock');
$$;
REVOKE ALL ON FUNCTION public.get_my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions(uuid) TO authenticated, service_role;

-- 3. Productos y variantes: solo con permiso de catálogo -------------------------------
-- SECURITY INVOKER: dentro de una RPC (SECURITY DEFINER) current_user es su dueño y no se
-- comprueba nada; solo se frenan las escrituras directas desde la app.
CREATE OR REPLACE FUNCTION public.protect_catalog_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NOT public.member_can(NEW.business_id, 'edit_catalog') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar productos ni precios' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_catalog_products ON public.products;
CREATE TRIGGER trg_protect_catalog_products
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.protect_catalog_writes();

DROP TRIGGER IF EXISTS trg_protect_catalog_variants ON public.product_variants;
CREATE TRIGGER trg_protect_catalog_variants
BEFORE INSERT OR UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.protect_catalog_writes();

-- 4. Clientes, facturas, líneas y cobros: escribir solo administradores -----------------
DROP POLICY IF EXISTS "Members can create clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can create clients" ON public.clients;
CREATE POLICY "Admins can create clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.has_min_role(business_id, 'admin'));
DROP POLICY IF EXISTS "Members can update clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can update clients" ON public.clients;
CREATE POLICY "Admins can update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin'))
  WITH CHECK (public.has_min_role(business_id, 'admin'));

DROP POLICY IF EXISTS "Members can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins can update invoices" ON public.invoices;
CREATE POLICY "Admins can update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin'))
  WITH CHECK (public.has_min_role(business_id, 'admin'));

DROP POLICY IF EXISTS "Members can insert invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins can insert invoice items" ON public.invoice_items;
CREATE POLICY "Admins can insert invoice items" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_min_role(i.business_id, 'admin')));
DROP POLICY IF EXISTS "Members can update invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Admins can update invoice items" ON public.invoice_items;
CREATE POLICY "Admins can update invoice items" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_min_role(i.business_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.has_min_role(i.business_id, 'admin')));

DROP POLICY IF EXISTS "Members can create payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can create payments" ON public.payments;
CREATE POLICY "Admins can create payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (public.has_min_role(business_id, 'admin'));
DROP POLICY IF EXISTS "Members can update payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin'))
  WITH CHECK (public.has_min_role(business_id, 'admin'));

-- 5. RR. HH.: lo de los demás, solo administradores --------------------------------------
DROP POLICY IF EXISTS "Members can view time entries" ON public.hr_time_entries;
DROP POLICY IF EXISTS "Own or admins view time entries" ON public.hr_time_entries;
CREATE POLICY "Own or admins view time entries" ON public.hr_time_entries
  FOR SELECT TO authenticated
  USING (public.has_min_role(business_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = employee_id AND e.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members can view work sessions" ON public.hr_work_sessions;
DROP POLICY IF EXISTS "Own or admins view work sessions" ON public.hr_work_sessions;
CREATE POLICY "Own or admins view work sessions" ON public.hr_work_sessions
  FOR SELECT TO authenticated
  USING (public.has_min_role(business_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = employee_id AND e.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members can view absences" ON public.hr_absences;
DROP POLICY IF EXISTS "Own or admins view absences" ON public.hr_absences;
CREATE POLICY "Own or admins view absences" ON public.hr_absences
  FOR SELECT TO authenticated
  USING (public.has_min_role(business_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = employee_id AND e.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members can view permissions" ON public.hr_permissions;
DROP POLICY IF EXISTS "Own or admins view permissions" ON public.hr_permissions;
CREATE POLICY "Own or admins view permissions" ON public.hr_permissions
  FOR SELECT TO authenticated
  USING (public.has_min_role(business_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = employee_id AND e.user_id = auth.uid()));

-- 6. Facturas y cobros: solo administradores (cuerpos vigentes, cambia la comprobación) --
CREATE OR REPLACE FUNCTION public.generate_invoice_number(_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prefix text;
BEGIN
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede numerar facturas' USING ERRCODE = '42501';
  END IF;
  INSERT INTO business_settings (business_id) VALUES (_business_id) ON CONFLICT (business_id) DO NOTHING;
  SELECT COALESCE(invoice_prefix, 'FAC-') INTO _prefix FROM business_settings WHERE business_id = _business_id;
  RETURN _prefix || LPAD(next_document_number(_business_id, 'invoice')::text, 6, '0');
END;
$$;

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

  SELECT COALESCE(bs.tax_rate, 21) INTO _tax_rate FROM business_settings bs WHERE bs.business_id = _business_id;
  IF NOT FOUND THEN _tax_rate := 21; END IF;

  -- Numeración correlativa (contador con bloqueo, dz/0018)
  _invoice_number := generate_invoice_number(_business_id);

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _total := _total + ROUND(COALESCE((_item->>'quantity')::numeric, 0) * COALESCE((_item->>'unit_price')::numeric, 0), 2);
  END LOOP;

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
    COALESCE(item->>'description', ''),
    COALESCE((item->>'quantity')::numeric, 1),
    COALESCE((item->>'unit_price')::numeric, 0),
    ROUND(COALESCE((item->>'quantity')::numeric, 1) * COALESCE((item->>'unit_price')::numeric, 0), 2)
  FROM jsonb_array_elements(_items) AS item;

  RETURN QUERY SELECT _invoice_id, _invoice_number;
END;
$$;

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
  _total_paid numeric;
  _new_status invoice_status;
BEGIN
  -- Validate membership
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar cobros' USING ERRCODE = '42501';
  END IF;

  -- Lock the invoice row to prevent concurrent updates
  SELECT * INTO _invoice
  FROM invoices
  WHERE id = _invoice_id
    AND business_id = _business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  -- Don't allow payments on draft or cancelled invoices
  IF _invoice.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en facturas borrador o canceladas';
  END IF;

  -- Validate amount
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  -- Insert the payment
  INSERT INTO payments (
    business_id,
    invoice_id,
    amount,
    payment_method,
    payment_date,
    notes,
    created_by
  ) VALUES (
    _business_id,
    _invoice_id,
    _amount,
    _payment_method,
    _payment_date,
    _notes,
    auth.uid()
  )
  RETURNING id INTO _payment_id;

  -- Calculate total paid for this invoice (including the new payment)
  SELECT COALESCE(SUM(amount), 0) INTO _total_paid
  FROM payments
  WHERE invoice_id = _invoice_id
    AND business_id = _business_id;

  -- Determine new status with refined logic:
  -- 1. If fully paid -> paid (set paid_at only if not already paid)
  -- 2. If already overdue -> stay overdue (no downgrade)
  -- 3. If past due_date -> overdue
  -- 4. Otherwise -> sent
  
  IF _total_paid >= _invoice.total THEN
    _new_status := 'paid';
    
    -- Only set paid_at if transitioning to paid for the first time
    IF _invoice.status != 'paid' THEN
      UPDATE invoices
      SET status = 'paid',
          paid_at = now(),
          updated_at = now()
      WHERE id = _invoice_id
        AND business_id = _business_id;
    END IF;
    
  ELSIF _invoice.status = 'overdue' THEN
    -- Already overdue: keep it overdue until fully paid (no downgrade)
    _new_status := 'overdue';
    -- No update needed, status stays the same
    
  ELSIF _invoice.due_date IS NOT NULL AND _invoice.due_date < CURRENT_DATE THEN
    -- Past due date: mark as overdue
    _new_status := 'overdue';
    
    UPDATE invoices
    SET status = 'overdue',
        updated_at = now()
    WHERE id = _invoice_id
      AND business_id = _business_id
      AND status != 'overdue';
      
  ELSE
    -- Not overdue, not fully paid: should be sent
    _new_status := 'sent';
    
    -- Only update if not already in a valid state
    UPDATE invoices
    SET status = 'sent',
        updated_at = now()
    WHERE id = _invoice_id
      AND business_id = _business_id
      AND status NOT IN ('sent', 'paid', 'overdue');
  END IF;

  RETURN _payment_id;
END;
$$;

-- 7. Panel de inicio: solo administradores (cuerpos vigentes) ------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(_business_id uuid)
RETURNS TABLE(
  monthly_revenue numeric,
  prev_monthly_revenue numeric,
  active_clients bigint,
  prev_active_clients bigint,
  pending_invoices bigint,
  pending_amount numeric,
  monthly_payments_count bigint,
  prev_monthly_payments_count bigint,
  overdue_invoices bigint,
  overdue_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _start_of_month date;
  _start_of_prev_month date;
BEGIN
  -- Validate membership
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede ver las métricas del negocio' USING ERRCODE = '42501';
  END IF;

  -- Calculate date boundaries
  _start_of_month := date_trunc('month', CURRENT_DATE)::date;
  _start_of_prev_month := (_start_of_month - interval '1 month')::date;

  RETURN QUERY
  WITH invoice_payments AS (
    -- Pre-calculate total paid per invoice
    SELECT 
      p.invoice_id,
      COALESCE(SUM(p.amount), 0) AS total_paid
    FROM payments p
    WHERE p.business_id = _business_id
    GROUP BY p.invoice_id
  )
  SELECT
    -- Monthly revenue (current month payments)
    COALESCE((
      SELECT SUM(p.amount)
      FROM payments p
      WHERE p.business_id = _business_id
        AND p.payment_date >= _start_of_month
        AND p.payment_date < (_start_of_month + interval '1 month')::date
    ), 0)::numeric AS monthly_revenue,
    
    -- Previous month revenue
    COALESCE((
      SELECT SUM(p.amount)
      FROM payments p
      WHERE p.business_id = _business_id
        AND p.payment_date >= _start_of_prev_month
        AND p.payment_date < _start_of_month
    ), 0)::numeric AS prev_monthly_revenue,
    
    -- Active clients count
    (
      SELECT COUNT(*)
      FROM clients c
      WHERE c.business_id = _business_id
        AND c.is_active = true
    )::bigint AS active_clients,
    
    -- Clients created before this month (for change calculation)
    (
      SELECT COUNT(*)
      FROM clients c
      WHERE c.business_id = _business_id
        AND c.is_active = true
        AND c.created_at < _start_of_month
    )::bigint AS prev_active_clients,
    
    -- Pending invoices count (sent + overdue)
    (
      SELECT COUNT(*)
      FROM invoices i
      WHERE i.business_id = _business_id
        AND i.status IN ('sent', 'overdue')
    )::bigint AS pending_invoices,
    
    -- Pending amount (total - paid, avoiding negatives from overpay)
    COALESCE((
      SELECT SUM(GREATEST(i.total - COALESCE(ip.total_paid, 0), 0))
      FROM invoices i
      LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
      WHERE i.business_id = _business_id
        AND i.status IN ('sent', 'overdue')
    ), 0)::numeric AS pending_amount,
    
    -- Monthly payments count
    (
      SELECT COUNT(*)
      FROM payments p
      WHERE p.business_id = _business_id
        AND p.payment_date >= _start_of_month
        AND p.payment_date < (_start_of_month + interval '1 month')::date
    )::bigint AS monthly_payments_count,
    
    -- Previous month payments count
    (
      SELECT COUNT(*)
      FROM payments p
      WHERE p.business_id = _business_id
        AND p.payment_date >= _start_of_prev_month
        AND p.payment_date < _start_of_month
    )::bigint AS prev_monthly_payments_count,
    
    -- Overdue invoices count
    (
      SELECT COUNT(*)
      FROM invoices i
      WHERE i.business_id = _business_id
        AND i.status = 'overdue'
    )::bigint AS overdue_invoices,
    
    -- Overdue amount (total - paid, avoiding negatives)
    COALESCE((
      SELECT SUM(GREATEST(i.total - COALESCE(ip.total_paid, 0), 0))
      FROM invoices i
      LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
      WHERE i.business_id = _business_id
        AND i.status = 'overdue'
    ), 0)::numeric AS overdue_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_recent_activity(
  _business_id uuid,
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  event_type text,
  event_id uuid,
  title text,
  description text,
  amount numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Validate membership
  IF NOT has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede ver la actividad del negocio' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  (
    -- Payments
    SELECT 
      'payment'::text AS event_type,
      p.id AS event_id,
      'Pago recibido'::text AS title,
      COALESCE(i.invoice_number, 'Sin factura')::text AS description,
      p.amount,
      p.created_at
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    WHERE p.business_id = _business_id

    UNION ALL

    -- Invoices
    SELECT 
      'invoice'::text AS event_type,
      inv.id AS event_id,
      CASE inv.status
        WHEN 'draft' THEN 'Factura borrador'
        WHEN 'sent' THEN 'Factura enviada'
        WHEN 'paid' THEN 'Factura pagada'
        WHEN 'overdue' THEN 'Factura vencida'
        ELSE 'Factura creada'
      END AS title,
      COALESCE(c.name, 'Sin cliente') || ' - ' || inv.invoice_number AS description,
      inv.total AS amount,
      inv.created_at
    FROM invoices inv
    LEFT JOIN clients c ON c.id = inv.client_id
    WHERE inv.business_id = _business_id

    UNION ALL

    -- New clients
    SELECT 
      'client'::text AS event_type,
      cl.id AS event_id,
      'Nuevo cliente'::text AS title,
      cl.name::text AS description,
      NULL::numeric AS amount,
      cl.created_at
    FROM clients cl
    WHERE cl.business_id = _business_id
  )
  ORDER BY created_at DESC
  LIMIT _limit;
END;
$$;

-- 8. Ajustar stock: permiso por persona (cuerpo de la 0025) ---------------------------
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

-- 9. Equipo: el correo de los demás, solo para administradores (cuerpo vigente) ----------
CREATE OR REPLACE FUNCTION public.get_business_team(_business_id uuid)
RETURNS TABLE(user_id uuid, full_name text, email text, role app_role, is_active boolean, joined_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_member_of_business(_business_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para ver el equipo de este negocio';
  END IF;

  RETURN QUERY
  SELECT bm.user_id, p.full_name,
         CASE WHEN public.has_min_role(_business_id, 'admin') OR public.is_super_admin() OR bm.user_id = auth.uid()
              THEN u.email::text END,
         bm.role, bm.is_active, bm.joined_at
  FROM public.business_members bm
  LEFT JOIN public.profiles p ON p.id = bm.user_id
  LEFT JOIN auth.users u ON u.id = bm.user_id
  WHERE bm.business_id = _business_id
  ORDER BY bm.role, p.full_name NULLS LAST;
END;
$$;

-- 10. Equipo: un administrador solo gestiona e invita a personal ----------------------------
DROP POLICY IF EXISTS "Owner/Admin can insert members" ON public.business_members;
CREATE POLICY "Owner/Admin can insert members"
ON public.business_members FOR INSERT
TO authenticated
WITH CHECK (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role = 'staff'::app_role AND user_id <> auth.uid())
);

DROP POLICY IF EXISTS "Owner/Admin can update members" ON public.business_members;
CREATE POLICY "Owner/Admin can update members"
ON public.business_members FOR UPDATE
TO authenticated
USING (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role = 'staff'::app_role AND user_id <> auth.uid())
)
WITH CHECK (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role = 'staff'::app_role AND user_id <> auth.uid())
);

-- La fila de un miembro no cambia de persona ni de negocio desde la app.
CREATE OR REPLACE FUNCTION public.protect_member_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
    RAISE EXCEPTION 'No se puede cambiar la persona ni el negocio de un miembro' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_member_identity ON public.business_members;
CREATE TRIGGER trg_protect_member_identity
BEFORE UPDATE ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.protect_member_identity();

DROP POLICY IF EXISTS "Admins can create invitations" ON public.business_invitations;
CREATE POLICY "Admins can create invitations"
ON public.business_invitations FOR INSERT
TO authenticated
WITH CHECK (
  (public.has_min_role(business_id, 'admin'::app_role) OR public.is_super_admin())
  AND invited_by = auth.uid()
  AND (role = 'staff'::app_role OR public.has_business_role(business_id, 'owner'::app_role) OR public.is_super_admin())
);
