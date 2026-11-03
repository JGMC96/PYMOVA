-- Movimientos de caja: gastos, entradas de cambio y retiradas al banco. El arqueo los cuenta.
-- - Solo con la caja abierta y solo por RPC. Con dependientes con PIN, cada movimiento lleva el
--   PIN de alguien con el permiso «Cerrar caja»; sin ellos, propietarios y administradores.
-- - No se editan ni se borran: se anulan con motivo mientras la caja siga abierta, y quedan a la vista.
-- - No se puede sacar más efectivo del que debería haber.
-- - Las cajas ya cerradas conservan sus cifras (expected_amount se guardó al cerrar).

-- 0. El PIN también vale para los movimientos (cuerpo de la 0057) ---------------------------
ALTER TABLE public.pos_authorizations DROP CONSTRAINT IF EXISTS pos_authorizations_action_check;
ALTER TABLE public.pos_authorizations ADD CONSTRAINT pos_authorizations_action_check
  CHECK (action IN ('discount', 'return', 'close_register', 'adjust_stock', 'cash_movement'));

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
  IF _action IS NULL OR _action NOT IN ('discount', 'return', 'close_register', 'adjust_stock', 'cash_movement') THEN
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
    WHEN 'cash_movement' THEN COALESCE(_perm.can_close_register, false)
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

-- 1. Tabla ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  register_session_id uuid NOT NULL REFERENCES public.cash_register_sessions(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('expense', 'cash_in', 'withdrawal')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  category text,
  reason text NOT NULL,
  created_by uuid,
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  void_reason text,
  CONSTRAINT cash_movements_category_only_expense CHECK ((movement_type = 'expense') = (category IS NOT NULL)),
  CONSTRAINT cash_movements_void_complete CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON public.cash_movements (register_session_id, created_at);
CREATE INDEX IF NOT EXISTS cash_movements_business_idx ON public.cash_movements (business_id, created_at DESC);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_movements FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.cash_movements FROM authenticated;
GRANT SELECT ON public.cash_movements TO authenticated;

DROP POLICY IF EXISTS "cash_movements_select_members" ON public.cash_movements;
CREATE POLICY "cash_movements_select_members" ON public.cash_movements
  FOR SELECT TO authenticated
  USING (is_member_of_business(business_id) OR is_super_admin());

DROP TRIGGER IF EXISTS trg_cash_movements_audit ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_audit
AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- 2. Efectivo esperado (interna): la fórmula del arqueo, en un solo sitio --------------------
CREATE OR REPLACE FUNCTION public.register_expected_cash(_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _opening numeric;
  _cash_sales numeric;
  _cash_refunds numeric;
  _movements numeric;
BEGIN
  SELECT c.opening_amount INTO _opening FROM cash_register_sessions c WHERE c.id = _session_id;

  -- Lo pagado con vale no entra en el cajón.
  SELECT COALESCE(SUM(s.total + COALESCE(s.tip, 0) - COALESCE(s.voucher_amount, 0)), 0) INTO _cash_sales
  FROM sales s
  WHERE s.register_session_id = _session_id AND s.payment_method = 'cash';

  SELECT COALESCE(SUM(r.total), 0) INTO _cash_refunds
  FROM sale_returns r
  WHERE r.register_session_id = _session_id AND r.refund_method = 'cash';

  SELECT COALESCE(SUM(CASE WHEN m.movement_type = 'cash_in' THEN m.amount ELSE -m.amount END), 0) INTO _movements
  FROM cash_movements m
  WHERE m.register_session_id = _session_id AND m.voided_at IS NULL;

  RETURN ROUND(_opening + _cash_sales - _cash_refunds + _movements, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.register_expected_cash(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Quién puede mover dinero (interna) ------------------------------------------------------
-- Devuelve la persona del PIN, o NULL en un negocio sin dependientes con PIN.
CREATE OR REPLACE FUNCTION public.cash_movement_actor(_business_id uuid, _authorization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.business_requires_seller(_business_id) THEN
    -- Decide el permiso de la persona del PIN, no el de la cuenta (la del TPV es compartida).
    RETURN consume_authorization(_business_id, _authorization_id, 'cash_movement', NULL);
  END IF;
  IF NOT public.has_min_role(_business_id, 'admin') THEN
    RAISE EXCEPTION 'No tienes permiso para mover dinero de la caja' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.cash_movement_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Apuntar un movimiento -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cash_movement(
  _session_id uuid,
  _type text,
  _amount numeric,
  _category text DEFAULT NULL,
  _reason text DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s cash_register_sessions%ROWTYPE;
  _clean_reason text := btrim(COALESCE(_reason, ''));
  _employee uuid;
  _id uuid;
BEGIN
  -- La caja bloqueada: ni se cierra a la vez ni dos salidas gastan el mismo efectivo.
  SELECT * INTO _s FROM cash_register_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT is_member_of_business(_s.business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para mover dinero de esta caja' USING ERRCODE = '42501';
  END IF;
  _employee := cash_movement_actor(_s.business_id, _authorization_id);

  IF _s.status <> 'open' THEN
    RAISE EXCEPTION 'La caja está cerrada: abre una para apuntar el movimiento' USING ERRCODE = '22023';
  END IF;
  IF _type IS NULL OR _type NOT IN ('expense', 'cash_in', 'withdrawal') THEN
    RAISE EXCEPTION 'Tipo de movimiento no válido' USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount <> ROUND(_amount, 2) OR _amount > 9999999 THEN
    RAISE EXCEPTION 'El importe no es válido' USING ERRCODE = '22023';
  END IF;
  IF _type = 'expense' AND (_category IS NULL OR _category NOT IN ('cleaning', 'drinks', 'office', 'courier', 'other')) THEN
    RAISE EXCEPTION 'Elige la categoría del gasto' USING ERRCODE = '22023';
  END IF;
  IF _type <> 'expense' AND _category IS NOT NULL THEN
    RAISE EXCEPTION 'Solo los gastos llevan categoría' USING ERRCODE = '22023';
  END IF;
  IF length(_clean_reason) < 3 OR length(_clean_reason) > 200 THEN
    RAISE EXCEPTION 'Indica el motivo (entre 3 y 200 caracteres)' USING ERRCODE = '22023';
  END IF;
  -- Sin decir cuánto hay: quien cuenta a ciegas no debe ver el efectivo esperado.
  IF _type <> 'cash_in' AND _amount > register_expected_cash(_session_id) THEN
    RAISE EXCEPTION 'No hay tanto efectivo en la caja' USING ERRCODE = '22023';
  END IF;

  INSERT INTO cash_movements (business_id, register_session_id, movement_type, amount, category, reason, created_by, employee_id)
  VALUES (_s.business_id, _session_id, _type, _amount, _category, _clean_reason, auth.uid(), _employee)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_cash_movement(uuid, text, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(uuid, text, numeric, text, text, uuid) TO authenticated, service_role;

-- 5. Anular un movimiento: queda a la vista y deja de contar -----------------------------------
CREATE OR REPLACE FUNCTION public.void_cash_movement(
  _movement_id uuid,
  _reason text DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _session_id uuid;
  _s cash_register_sessions%ROWTYPE;
  _m cash_movements%ROWTYPE;
  _clean_reason text := btrim(COALESCE(_reason, ''));
  _employee uuid;
BEGIN
  SELECT m.register_session_id INTO _session_id FROM cash_movements m WHERE m.id = _movement_id;
  -- La misma caja bloqueada que al apuntar, y solo entonces se mira el movimiento.
  SELECT * INTO _s FROM cash_register_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT is_member_of_business(_s.business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para anular este movimiento' USING ERRCODE = '42501';
  END IF;
  _employee := cash_movement_actor(_s.business_id, _authorization_id);

  SELECT * INTO _m FROM cash_movements m WHERE m.id = _movement_id;
  IF _s.status <> 'open' THEN
    RAISE EXCEPTION 'La caja ya está cerrada: apunta la corrección en el turno siguiente' USING ERRCODE = '22023';
  END IF;
  IF _m.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este movimiento ya está anulado' USING ERRCODE = '22023';
  END IF;
  IF length(_clean_reason) < 3 OR length(_clean_reason) > 200 THEN
    RAISE EXCEPTION 'Indica el motivo (entre 3 y 200 caracteres)' USING ERRCODE = '22023';
  END IF;

  UPDATE cash_movements
  SET voided_at = now(),
      voided_by = auth.uid(),
      voided_by_employee_id = _employee,
      void_reason = _clean_reason
  WHERE id = _movement_id;

  IF _m.movement_type = 'cash_in' AND register_expected_cash(_session_id) < 0 THEN
    RAISE EXCEPTION 'No se puede anular: ese efectivo ya ha salido de la caja' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.void_cash_movement(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_cash_movement(uuid, text, uuid) TO authenticated, service_role;

-- 6. Lista de movimientos de una caja, con los nombres -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_cash_movements(_session_id uuid)
RETURNS TABLE(
  id uuid,
  movement_type text,
  amount numeric,
  category text,
  reason text,
  who text,
  created_at timestamptz,
  voided_at timestamptz,
  voided_who text,
  void_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
BEGIN
  SELECT c.business_id INTO _business_id FROM cash_register_sessions c WHERE c.id = _session_id;
  IF _business_id IS NULL OR NOT (is_member_of_business(_business_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esta caja' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.movement_type, m.amount, m.category, m.reason,
         COALESCE(
           CASE WHEN m.employee_id IS NOT NULL THEN employee_display_name(m.employee_id) END,
           NULLIF(btrim(pr.full_name), ''),
           CASE WHEN m.created_by IS NOT NULL THEN 'Cuenta sin nombre' END
         )::text,
         m.created_at,
         m.voided_at,
         CASE WHEN m.voided_at IS NOT NULL THEN COALESCE(
           CASE WHEN m.voided_by_employee_id IS NOT NULL THEN employee_display_name(m.voided_by_employee_id) END,
           NULLIF(btrim(pv.full_name), ''),
           'Cuenta sin nombre'
         ) END::text,
         m.void_reason
  FROM cash_movements m
  LEFT JOIN profiles pr ON pr.id = m.created_by
  LEFT JOIN profiles pv ON pv.id = m.voided_by
  WHERE m.register_session_id = _session_id
  ORDER BY m.created_at DESC, m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_cash_movements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_movements(uuid) TO authenticated, service_role;

-- 7. Cierre de caja: cuenta los movimientos (cuerpo de la 0039) --------------------------------
CREATE OR REPLACE FUNCTION public.close_register_session(
  _session_id uuid,
  _counted_amount numeric,
  _notes text DEFAULT NULL,
  _seller_session_id uuid DEFAULT NULL,
  _authorization_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s cash_register_sessions%ROWTYPE;
  _expected numeric;
  _closer uuid;
  _can_close boolean;
  _authorizer uuid;
BEGIN
  SELECT * INTO _s FROM cash_register_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT is_member_of_business(_s.business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar esta caja' USING ERRCODE = '42501';
  END IF;
  IF _s.status = 'closed' THEN
    RAISE EXCEPTION 'La caja ya está cerrada' USING ERRCODE = '22023';
  END IF;
  IF _counted_amount IS NULL OR _counted_amount < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser negativo' USING ERRCODE = '22023';
  END IF;

  -- Con dependientes con PIN: cierra una persona identificada, con permiso o autorizada.
  IF _seller_session_id IS NOT NULL THEN
    _closer := seller_from_session(_s.business_id, _seller_session_id);
  ELSIF business_requires_seller(_s.business_id) THEN
    RAISE EXCEPTION 'Falta la sesión de vendedor: identifícate con tu PIN en el TPV' USING ERRCODE = '42501';
  END IF;
  IF _closer IS NOT NULL AND business_requires_seller(_s.business_id) THEN
    SELECT p.can_close_register INTO _can_close FROM employee_effective_permissions(_closer) p;
    IF NOT COALESCE(_can_close, false) THEN
      IF _authorization_id IS NULL THEN
        RAISE EXCEPTION 'Necesita autorización: esta persona no puede cerrar la caja' USING ERRCODE = '42501';
      END IF;
      _authorizer := consume_authorization(_s.business_id, _authorization_id, 'close_register', NULL);
    END IF;
  END IF;

  _expected := register_expected_cash(_session_id);

  UPDATE cash_register_sessions
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      closed_by_employee_id = _closer,
      close_authorized_by_employee_id = _authorizer,
      counted_amount = ROUND(_counted_amount, 2),
      expected_amount = _expected,
      difference = ROUND(_counted_amount, 2) - _expected,
      notes = _notes,
      updated_at = now()
  WHERE id = _session_id;
END;
$$;
REVOKE ALL ON FUNCTION public.close_register_session(uuid, numeric, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_register_session(uuid, numeric, text, uuid, uuid) TO authenticated, service_role;
