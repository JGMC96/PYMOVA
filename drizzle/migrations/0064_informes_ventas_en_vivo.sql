-- Informes: ventas de tienda y online, en vivo, por fechas y meses, para personas autorizadas.
--
-- 1. Permiso «Ver ventas» por persona. El propietario lo ve siempre; nadie más (tampoco los
--    administradores ni el super admin) hasta que el propietario se lo concede. Va unido a la
--    persona Y a su cuenta: si la ficha pasa a otra cuenta, no se traspasa. Se pierde al dar de
--    baja. Tabla aparte para no tocar los permisos del TPV (0030).
-- 2. get_sales_report_v2: tienda (PYMOVA y tickets de Stockagile) y online (pedidos de Shopify).
--    · Fechas en la zona horaria del negocio. Importes con IVA.
--    · Online: sin cancelados ni anulados; el importe actual del pedido, con envío (las
--      devoluciones ya vienen restadas, en la fecha del pedido). Devuelto entero: 0, sin contar
--      como ticket. Los pedidos que son ventas de la caja de PYMOVA no se cuentan.
--    · «Hoy» se compara con el mismo día del año anterior hasta la misma hora.
--    · Las ventas por vendedor, solo para el propietario. Sin datos de clientas.
--    get_sales_report (0055) no cambia: la pantalla publicada sigue igual hasta publicar.
-- Solo lectura sobre ventas, caja y stock. Migración aditiva e idempotente, sin secretos.

-- 1. Quién puede ver las ventas ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_report_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL UNIQUE REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_report_access_user_idx ON public.sales_report_access (business_id, user_id);
-- Sin acceso directo: solo por las funciones de abajo.
ALTER TABLE public.sales_report_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_report_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sales_report_access TO service_role;

DROP TRIGGER IF EXISTS trg_sales_report_access_audit ON public.sales_report_access;
CREATE TRIGGER trg_sales_report_access_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sales_report_access
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- ¿Puede la cuenta que llama ver las ventas de este negocio?
CREATE OR REPLACE FUNCTION public.can_see_sales(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_business_role(_business_id, 'owner')
    OR (public.mfa_satisfied() AND EXISTS (
      SELECT 1
      FROM sales_report_access a
      JOIN hr_employees e ON e.id = a.employee_id AND e.business_id = a.business_id
        AND e.user_id = a.user_id AND e.is_active
      JOIN business_members m ON m.business_id = a.business_id AND m.user_id = a.user_id AND m.is_active
      WHERE a.business_id = _business_id AND a.user_id = auth.uid()
    ));
$$;
REVOKE ALL ON FUNCTION public.can_see_sales(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_sales(uuid) TO authenticated, service_role;

-- Personas que tienen el permiso concedido y en vigor (solo el propietario).
CREATE OR REPLACE FUNCTION public.get_sales_access(_business_id uuid)
RETURNS TABLE(employee_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede ver quién ve las ventas' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.employee_id
  FROM sales_report_access a
  JOIN hr_employees e ON e.id = a.employee_id AND e.business_id = a.business_id
    AND e.user_id = a.user_id AND e.is_active
  JOIN business_members m ON m.business_id = a.business_id AND m.user_id = a.user_id AND m.is_active
  WHERE a.business_id = _business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_access(uuid) TO authenticated, service_role;

-- Conceder o quitar «Ver ventas» (solo el propietario).
CREATE OR REPLACE FUNCTION public.set_sales_access(_business_id uuid, _employee_id uuid, _allowed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user uuid;
  _active boolean;
  _role app_role;
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede decidir quién ve las ventas' USING ERRCODE = '42501';
  END IF;
  SELECT e.user_id, e.is_active INTO _user, _active FROM hr_employees e
  WHERE e.id = _employee_id AND e.business_id = _business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona no pertenece a este negocio' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(_allowed, false) THEN
    DELETE FROM sales_report_access a WHERE a.business_id = _business_id AND a.employee_id = _employee_id;
    RETURN;
  END IF;

  SELECT m.role INTO _role FROM business_members m
  WHERE m.business_id = _business_id AND m.user_id = _user AND m.is_active;
  IF _user IS NULL OR NOT _active OR _role IS NULL THEN
    RAISE EXCEPTION 'Para ver las ventas la persona necesita su propia cuenta y estar activa' USING ERRCODE = '22023';
  END IF;
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'El propietario ya ve las ventas' USING ERRCODE = '22023';
  END IF;

  INSERT INTO sales_report_access (business_id, employee_id, user_id, granted_by)
  VALUES (_business_id, _employee_id, _user, auth.uid())
  ON CONFLICT (employee_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, granted_by = EXCLUDED.granted_by, granted_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_sales_access(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sales_access(uuid, uuid, boolean) TO authenticated, service_role;

-- Al dar de baja (o cambiar la cuenta de la ficha), el permiso se borra: no revive al volver.
CREATE OR REPLACE FUNCTION public.revoke_sales_access_on_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT NEW.is_active OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    DELETE FROM sales_report_access a WHERE a.employee_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_sales_access_on_employee() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_hr_employees_sales_access ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_sales_access
AFTER UPDATE OF is_active, user_id ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.revoke_sales_access_on_employee();

CREATE OR REPLACE FUNCTION public.revoke_sales_access_on_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NOT NEW.is_active OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    DELETE FROM sales_report_access a WHERE a.business_id = OLD.business_id AND a.user_id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_sales_access_on_member() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_members_sales_access ON public.business_members;
CREATE TRIGGER trg_business_members_sales_access
AFTER UPDATE OF is_active, user_id OR DELETE ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.revoke_sales_access_on_member();

-- 2. Para no contar dos veces las ventas de la caja que también son pedidos de Shopify ---------
CREATE INDEX IF NOT EXISTS sales_business_shopify_gid_idx
  ON public.sales (business_id, shopify_order_gid) WHERE shopify_order_gid IS NOT NULL;

-- 3. Informe ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_report_v2(_business_id uuid, _from date, _to date, _channel text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tz text;
  _pf date;
  _pt date;
  _local_now timestamp;
  _prev_end timestamptz;
  _cut text;
  _see_sellers boolean;
  _result jsonb;
BEGIN
  IF NOT can_see_sales(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las ventas' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Periodo no válido' USING ERRCODE = '22023';
  END IF;
  IF _to - _from > 1096 THEN
    RAISE EXCEPTION 'El periodo no puede pasar de 3 años' USING ERRCODE = '22023';
  END IF;
  IF _channel IS NULL OR _channel NOT IN ('all', 'store', 'online') THEN
    RAISE EXCEPTION 'Canal no válido' USING ERRCODE = '22023';
  END IF;
  _see_sellers := has_business_role(_business_id, 'owner');

  SELECT COALESCE(NULLIF(b.timezone, ''), 'Europe/Madrid') INTO _tz FROM businesses b WHERE b.id = _business_id;
  BEGIN
    PERFORM now() AT TIME ZONE _tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    _tz := 'Europe/Madrid';
  END;

  -- Mismo periodo un año antes (el 29 de febrero cae en el 28).
  _pf := (_from - interval '1 year')::date;
  _pt := (_to - interval '1 year')::date;
  _prev_end := (_pt + 1)::timestamp AT TIME ZONE _tz;
  -- «Hoy»: el año anterior solo hasta la misma hora.
  _local_now := now() AT TIME ZONE _tz;
  IF _from = _to AND _to = _local_now::date THEN
    _prev_end := (_pt + _local_now::time) AT TIME ZONE _tz;
    _cut := to_char(_local_now, 'HH24:MI');
  END IF;

  WITH rng AS (
    SELECT 'cur'::text AS per, _from::timestamp AT TIME ZONE _tz AS a, (_to + 1)::timestamp AT TIME ZONE _tz AS b
    UNION ALL
    SELECT 'prev', _pf::timestamp AT TIME ZONE _tz, _prev_end
  ),
  lines AS (
    -- Caja de PYMOVA: ventas
    SELECT r.per, 'store'::text AS ch, 'pymova'::text AS src, (s.created_at AT TIME ZONE _tz)::date AS d,
           'sale'::text AS kind, s.total::numeric AS amount,
           COALESCE(s.seller_employee_id::text, 'none') AS seller_key,
           COALESCE(s.payment_method, 'other')::text AS pay, COALESCE(s.voucher_amount, 0)::numeric AS voucher,
           0::numeric AS shipping
    FROM rng r JOIN sales s ON s.business_id = _business_id AND s.created_at >= r.a AND s.created_at < r.b
    UNION ALL
    -- Caja de PYMOVA: devoluciones (a quien las hizo, por la forma en que se reembolsó)
    SELECT r.per, 'store', 'pymova', (x.created_at AT TIME ZONE _tz)::date, 'return', -x.total::numeric,
           COALESCE(x.seller_employee_id::text, 'none'), COALESCE(x.refund_method, 'other')::text, 0, 0
    FROM rng r JOIN sale_returns x ON x.business_id = _business_id AND x.created_at >= r.a AND x.created_at < r.b
    UNION ALL
    -- Tickets de Stockagile
    SELECT r.per, 'store', 'stockagile', (k.sold_at AT TIME ZONE _tz)::date,
           CASE WHEN NOT k.is_return THEN 'sale' WHEN k.total <= 0 THEN 'return' ELSE 'exchange' END,
           k.total::numeric, 'stockagile',
           CASE
             WHEN k.payment_methods IS NULL OR btrim(k.payment_methods) = '' THEN 'none'
             WHEN lower(k.payment_methods) ~ '(metálico|metalico|efectivo|cash)'
              AND lower(k.payment_methods) ~ '(tarjeta|card)' THEN 'cash_card'
             WHEN lower(k.payment_methods) ~ '(metálico|metalico|efectivo|cash)' THEN 'cash'
             WHEN lower(k.payment_methods) ~ '(tarjeta|card)' THEN 'card'
             ELSE 'other'
           END,
           0, 0
    FROM rng r JOIN stockagile_sales k ON k.business_id = _business_id AND NOT k.deleted
      AND k.sold_at >= r.a AND k.sold_at < r.b
    UNION ALL
    -- Pedidos de la web (los que son ventas de la caja de PYMOVA ya están arriba)
    SELECT r.per, 'online', 'shopify', (o.created_at AT TIME ZONE _tz)::date,
           CASE WHEN g.returned THEN 'online_returned' ELSE 'sale' END,
           CASE WHEN g.returned THEN 0 ELSE o.total END::numeric, NULL, 'web', 0,
           CASE WHEN g.returned THEN 0 ELSE o.shipping_cost END::numeric
    FROM rng r
    JOIN online_orders o ON o.business_id = _business_id AND o.created_at >= r.a AND o.created_at < r.b
    CROSS JOIN LATERAL (
      SELECT o.status::text = 'returned' OR (o.payment_status = 'refunded' AND o.total <= 0) AS returned
    ) g
    WHERE o.source = 'shopify' AND o.status::text <> 'cancelled' AND o.payment_status IS DISTINCT FROM 'voided'
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.business_id = _business_id AND s.shopify_order_gid = o.external_id)
  ),
  f AS (
    SELECT * FROM lines l WHERE _channel = 'all' OR l.ch = _channel
  ),
  kpi AS (
    SELECT p.per,
           count(*) FILTER (WHERE f.kind = 'sale') AS sales_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.kind = 'sale'), 0) AS sales_total,
           count(*) FILTER (WHERE f.kind = 'return') AS returns_count,
           -COALESCE(sum(f.amount) FILTER (WHERE f.kind = 'return'), 0) AS returns_total,
           count(*) FILTER (WHERE f.kind = 'exchange') AS exchanges_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.kind = 'exchange'), 0) AS exchanges_total,
           count(*) FILTER (WHERE f.kind = 'online_returned') AS online_returned_count,
           COALESCE(sum(f.shipping), 0) AS shipping_total,
           COALESCE(sum(f.amount), 0) AS net_total
    FROM (VALUES ('cur'), ('prev')) p(per) LEFT JOIN f ON f.per = p.per
    GROUP BY p.per
  ),
  -- Tienda y online por separado, siempre, aunque se filtre por uno.
  chan AS (
    SELECT c.ch AS channel,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale') AS cur_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur'), 0) AS cur_net,
           COALESCE(sum(l.shipping) FILTER (WHERE l.per = 'cur'), 0) AS cur_shipping,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'online_returned') AS cur_returned,
           count(*) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale') AS prev_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev'), 0) AS prev_net
    FROM (VALUES ('store'), ('online')) c(ch) LEFT JOIN lines l ON l.ch = c.ch
    GROUP BY c.ch
  ),
  kpi_src AS (
    SELECT f.per, f.src,
           count(*) FILTER (WHERE f.kind = 'sale') AS sales_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.kind = 'sale'), 0) AS sales_total,
           COALESCE(sum(f.amount), 0) AS net_total
    FROM f GROUP BY f.per, f.src
  ),
  paylines AS (
    SELECT l.per, l.kind, v.m, v.a
    FROM f l
    CROSS JOIN LATERAL (VALUES (l.pay, l.amount - l.voucher), ('store_credit', l.voucher)) v(m, a)
    WHERE l.kind <> 'online_returned'
      AND ((v.m = l.pay AND (l.voucher = 0 OR v.a > 0)) OR (v.m = 'store_credit' AND l.voucher > 0))
  ),
  pay AS (
    SELECT p.m,
           count(*) FILTER (WHERE p.per = 'cur' AND p.kind = 'sale') AS cur_count,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'cur' AND p.kind = 'sale'), 0) AS cur_sales,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE p.per = 'prev' AND p.kind = 'sale') AS prev_count,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'prev' AND p.kind = 'sale'), 0) AS prev_sales,
           COALESCE(sum(p.a) FILTER (WHERE p.per = 'prev'), 0) AS prev_net
    FROM paylines p GROUP BY p.m
  ),
  sel AS (
    SELECT f.seller_key,
           count(*) FILTER (WHERE f.per = 'cur' AND f.kind = 'sale') AS cur_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'cur' AND f.kind = 'sale'), 0) AS cur_sales,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE f.per = 'prev' AND f.kind = 'sale') AS prev_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'prev' AND f.kind = 'sale'), 0) AS prev_sales,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'prev'), 0) AS prev_net
    FROM f WHERE _see_sellers AND f.ch = 'store'
    GROUP BY f.seller_key
  ),
  -- Cada fila del año anterior se coloca en su día un año después.
  dayagg AS (
    SELECT CASE WHEN f.per = 'cur' THEN f.d ELSE (f.d + interval '1 year')::date END AS d,
           count(*) FILTER (WHERE f.per = 'cur' AND f.kind = 'sale') AS cur_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'cur' AND f.ch = 'store'), 0) AS cur_store,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'cur' AND f.ch = 'online'), 0) AS cur_online,
           count(*) FILTER (WHERE f.per = 'prev' AND f.kind = 'sale') AS prev_count,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'prev' AND f.ch = 'store'), 0) AS prev_store,
           COALESCE(sum(f.amount) FILTER (WHERE f.per = 'prev' AND f.ch = 'online'), 0) AS prev_online
    FROM f GROUP BY 1
  ),
  monthagg AS (
    SELECT date_trunc('month', a.d::timestamp)::date AS m,
           sum(a.cur_count) AS cur_count, sum(a.cur_store) AS cur_store, sum(a.cur_online) AS cur_online,
           sum(a.prev_count) AS prev_count, sum(a.prev_store) AS prev_store, sum(a.prev_online) AS prev_online
    FROM dayagg a
    WHERE a.d BETWEEN _from AND _to
    GROUP BY 1
  ),
  -- Las 10 ventas más recientes (sin datos de clientas), sea cual sea el periodo.
  latest AS (
    SELECT u.at, u.ch, u.amount
    FROM (
      (SELECT s.created_at AS at, 'store'::text AS ch, s.total::numeric AS amount FROM sales s
       WHERE s.business_id = _business_id AND _channel <> 'online'
       ORDER BY s.created_at DESC LIMIT 10)
      UNION ALL
      (SELECT k.sold_at, 'store', k.total::numeric FROM stockagile_sales k
       WHERE k.business_id = _business_id AND _channel <> 'online' AND NOT k.deleted AND NOT k.is_return
       ORDER BY k.sold_at DESC LIMIT 10)
      UNION ALL
      (SELECT o.created_at, 'online', o.total::numeric FROM online_orders o
       WHERE o.business_id = _business_id AND _channel <> 'store' AND o.source = 'shopify'
         AND o.status::text NOT IN ('cancelled', 'returned') AND o.payment_status IS DISTINCT FROM 'voided'
         AND NOT (o.payment_status = 'refunded' AND o.total <= 0)
         AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.business_id = _business_id AND s.shopify_order_gid = o.external_id)
       ORDER BY o.created_at DESC LIMIT 10)
    ) u
    ORDER BY u.at DESC LIMIT 10
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to),
    'previous', jsonb_build_object('from', _pf, 'to', _pt),
    'prior_until', _cut,
    'channel', _channel,
    'can_see_sellers', _see_sellers,
    'generated_at', now(),
    'current', (SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'cur'),
    'prior', (SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'prev'),
    'by_channel', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.channel DESC) FROM chan c),
    'by_source', COALESCE((
      SELECT jsonb_agg(to_jsonb(k) ORDER BY k.src, k.per) FROM kpi_src k), '[]'::jsonb),
    'by_payment', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.cur_net DESC, p.prev_net DESC, p.m) FROM pay p), '[]'::jsonb),
    'by_seller', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'seller_key', s.seller_key,
        'name', CASE s.seller_key
                  WHEN 'none' THEN 'Sin vendedor'
                  WHEN 'stockagile' THEN 'Stockagile (sin vendedor)'
                  ELSE public.employee_display_name(s.seller_key::uuid) END,
        'cur_count', s.cur_count, 'cur_sales', s.cur_sales, 'cur_net', s.cur_net,
        'prev_count', s.prev_count, 'prev_sales', s.prev_sales, 'prev_net', s.prev_net)
        ORDER BY s.cur_net DESC, s.prev_net DESC, s.seller_key)
      FROM sel s), '[]'::jsonb),
    'by_month', (
      SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(g.m, 'YYYY-MM'),
        'cur_count', COALESCE(a.cur_count, 0), 'cur_store', COALESCE(a.cur_store, 0),
        'cur_online', COALESCE(a.cur_online, 0),
        'prev_count', COALESCE(a.prev_count, 0), 'prev_store', COALESCE(a.prev_store, 0),
        'prev_online', COALESCE(a.prev_online, 0)) ORDER BY g.m)
      FROM generate_series(date_trunc('month', _from::timestamp), date_trunc('month', _to::timestamp), interval '1 month') g(m)
      LEFT JOIN monthagg a ON a.m = g.m::date),
    'by_day', CASE WHEN _to - _from > 92 THEN '[]'::jsonb ELSE (
      SELECT jsonb_agg(jsonb_build_object(
        'date', g.d::date,
        'cur_count', COALESCE(a.cur_count, 0), 'cur_store', COALESCE(a.cur_store, 0),
        'cur_online', COALESCE(a.cur_online, 0),
        'prev_count', COALESCE(a.prev_count, 0), 'prev_store', COALESCE(a.prev_store, 0),
        'prev_online', COALESCE(a.prev_online, 0)) ORDER BY g.d)
      FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(d)
      LEFT JOIN dayagg a ON a.d = g.d::date) END,
    'latest', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', l.at, 'channel', l.ch, 'amount', l.amount) ORDER BY l.at DESC)
      FROM latest l), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_report_v2(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report_v2(uuid, date, date, text) TO authenticated, service_role;
