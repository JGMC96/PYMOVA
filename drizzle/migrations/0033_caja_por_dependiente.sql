-- Caja por dependiente.
-- - Abrir caja: con dependientes con PIN, la abre una persona identificada (como el cierre
--   desde la 0030) y queda en opened_by_employee_id.
-- - Desglose del turno por vendedor (get_register_seller_summary): ventas, efectivo,
--   devoluciones y neto de cada uno. Respeta el arqueo a ciegas de la 0030: con la caja
--   abierta, los importes solo salen si entre las personas conectadas hay alguien que puede
--   cerrar caja.
-- Migración idempotente, sin secretos.

ALTER TABLE public.cash_register_sessions
  ADD COLUMN IF NOT EXISTS opened_by_employee_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL;

-- 1. Abrir caja (cuerpo de la 0021 más la persona que abre) ---------------------------
DROP FUNCTION IF EXISTS public.open_register_session(uuid, numeric);

CREATE OR REPLACE FUNCTION public.open_register_session(
  _business_id uuid,
  _opening_amount numeric DEFAULT 0,
  _seller_session_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _opener uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para abrir caja en este negocio' USING ERRCODE = '42501';
  END IF;

  -- Con dependientes con PIN, abre una persona identificada.
  IF _seller_session_id IS NOT NULL THEN
    _opener := seller_from_session(_business_id, _seller_session_id);
  ELSIF business_requires_seller(_business_id) THEN
    RAISE EXCEPTION 'Falta la sesión de vendedor: identifícate con tu PIN en el TPV' USING ERRCODE = '42501';
  END IF;

  -- Una apertura a la vez por negocio.
  PERFORM pg_advisory_xact_lock(hashtextextended('open_register_session:' || _business_id::text, 0));

  IF EXISTS (SELECT 1 FROM cash_register_sessions WHERE business_id = _business_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una caja abierta' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(_opening_amount, 0) < 0 THEN
    RAISE EXCEPTION 'El fondo de caja no puede ser negativo' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO cash_register_sessions (business_id, opening_amount, opened_by, opened_by_employee_id)
    VALUES (_business_id, ROUND(COALESCE(_opening_amount, 0), 2), auth.uid(), _opener)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay una caja abierta' USING ERRCODE = '22023';
  END;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_register_session(uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_register_session(uuid, numeric, uuid) TO authenticated, service_role;

-- 2. Desglose del turno por vendedor -------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_register_seller_summary(_session_id uuid, _seller_session_ids uuid[] DEFAULT NULL)
RETURNS TABLE(
  employee_id uuid,
  name text,
  sales_count bigint,
  sales_total numeric,
  cash_total numeric,
  refunds_count bigint,
  refunds_total numeric,
  net_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
  _status text;
  _visible boolean;
BEGIN
  SELECT c.business_id, c.status INTO _business_id, _status FROM cash_register_sessions c WHERE c.id = _session_id;
  IF _business_id IS NULL OR NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esta caja' USING ERRCODE = '42501';
  END IF;

  -- Mismo criterio que get_register_summary (0030).
  _visible := _status <> 'open' OR NOT business_requires_seller(_business_id) OR EXISTS (
    SELECT 1 FROM pos_seller_sessions ps
    CROSS JOIN LATERAL employee_effective_permissions(ps.employee_id) ep
    WHERE ps.id = ANY (COALESCE(_seller_session_ids, '{}'::uuid[]))
      AND ps.business_id = _business_id AND ps.opened_by = auth.uid() AND ps.expires_at > now()
      AND ep.can_close_register
  );

  RETURN QUERY
  WITH v AS (
    SELECT s.seller_employee_id AS emp, COUNT(*) AS c,
           SUM(s.total + COALESCE(s.tip, 0)) AS t,
           SUM(CASE WHEN s.payment_method = 'cash' THEN s.total + COALESCE(s.tip, 0) ELSE 0 END) AS cash
    FROM sales s WHERE s.register_session_id = _session_id GROUP BY 1
  ), d AS (
    SELECT r.seller_employee_id AS emp, COUNT(*) AS c, SUM(r.total) AS t
    FROM sale_returns r WHERE r.register_session_id = _session_id GROUP BY 1
  ), emps AS (
    SELECT v.emp FROM v UNION SELECT d.emp FROM d
  )
  SELECT e.emp,
         CASE WHEN e.emp IS NULL THEN 'Sin vendedor' ELSE public.employee_display_name(e.emp) END,
         COALESCE(v.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(v.t, 0)::numeric END,
         CASE WHEN _visible THEN COALESCE(v.cash, 0)::numeric END,
         COALESCE(d.c, 0)::bigint,
         CASE WHEN _visible THEN COALESCE(d.t, 0)::numeric END,
         CASE WHEN _visible THEN (COALESCE(v.t, 0) - COALESCE(d.t, 0))::numeric END
  FROM emps e
  LEFT JOIN v ON v.emp IS NOT DISTINCT FROM e.emp
  LEFT JOIN d ON d.emp IS NOT DISTINCT FROM e.emp
  ORDER BY COALESCE(v.c, 0) DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_seller_summary(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_register_seller_summary(uuid, uuid[]) TO authenticated, service_role;
