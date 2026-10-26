-- Informe de ventas del periodo (apartado «Informes», solo propietario).
--
-- Una sola RPC de solo lectura que suma las ventas de PYMOVA (sales, sale_returns) y los tickets
-- de Stockagile (stockagile_sales, 0046) y los compara con el mismo periodo del año anterior.
-- · Fechas en la zona horaria del negocio. Importes con IVA y sin propinas.
-- · Stockagile: sin tickets borrados; el importe ya viene con signo. Venta = no devolución;
--   devolución = devolución con importe <= 0; cambio = devolución con importe > 0 (no cuenta
--   como ticket de venta, pero su importe entra en el neto).
-- · Formas de pago: PYMOVA como el cierre de caja (la parte pagada con vale va aparte, en
--   «store_credit»). Stockagile solo guarda el nombre: cash, card, cash_card (los dos, sin
--   desglose), other o none (sin dato).
-- · Sin datos de clientas. No toca caja, stock ni ventas.
-- Migración aditiva e idempotente, sin secretos.

-- 1. Índice para filtrar las ventas por fecha ------------------------------------------------
CREATE INDEX IF NOT EXISTS sales_business_created_idx ON public.sales (business_id, created_at);

-- 2. Informe -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_report(_business_id uuid, _from date, _to date)
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
  _result jsonb;
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede ver los informes' USING ERRCODE = '42501';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Periodo no válido' USING ERRCODE = '22023';
  END IF;
  IF _to - _from > 400 THEN
    RAISE EXCEPTION 'El periodo no puede pasar de 400 días' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(b.timezone, ''), 'Europe/Madrid') INTO _tz FROM businesses b WHERE b.id = _business_id;
  BEGIN
    PERFORM now() AT TIME ZONE _tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    _tz := 'Europe/Madrid';
  END;

  -- Mismo periodo un año antes (el 29 de febrero cae en el 28).
  _pf := (_from - interval '1 year')::date;
  _pt := (_to - interval '1 year')::date;

  WITH rng AS (
    SELECT 'cur'::text AS per, _from::timestamp AT TIME ZONE _tz AS a, (_to + 1)::timestamp AT TIME ZONE _tz AS b
    UNION ALL
    SELECT 'prev', _pf::timestamp AT TIME ZONE _tz, (_pt + 1)::timestamp AT TIME ZONE _tz
  ),
  lines AS (
    -- Ventas de PYMOVA
    SELECT r.per, 'pymova'::text AS src, (s.created_at AT TIME ZONE _tz)::date AS d, 'sale'::text AS kind,
           s.total::numeric AS amount, COALESCE(s.seller_employee_id::text, 'none') AS seller_key,
           COALESCE(s.payment_method, 'other')::text AS pay, COALESCE(s.voucher_amount, 0)::numeric AS voucher
    FROM rng r JOIN sales s ON s.business_id = _business_id AND s.created_at >= r.a AND s.created_at < r.b
    UNION ALL
    -- Devoluciones de PYMOVA (a quien las hizo, por la forma en que se reembolsó)
    SELECT r.per, 'pymova', (x.created_at AT TIME ZONE _tz)::date, 'return',
           -x.total::numeric, COALESCE(x.seller_employee_id::text, 'none'),
           COALESCE(x.refund_method, 'other')::text, 0::numeric
    FROM rng r JOIN sale_returns x ON x.business_id = _business_id AND x.created_at >= r.a AND x.created_at < r.b
    UNION ALL
    -- Tickets de Stockagile
    SELECT r.per, 'stockagile', (k.sold_at AT TIME ZONE _tz)::date,
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
           0::numeric
    FROM rng r JOIN stockagile_sales k ON k.business_id = _business_id AND NOT k.deleted
      AND k.sold_at >= r.a AND k.sold_at < r.b
  ),
  paylines AS (
    SELECT l.per, l.kind, v.m, v.a
    FROM lines l
    CROSS JOIN LATERAL (VALUES (l.pay, l.amount - l.voucher), ('store_credit', l.voucher)) v(m, a)
    WHERE (v.m = l.pay AND (l.voucher = 0 OR v.a > 0)) OR (v.m = 'store_credit' AND l.voucher > 0)
  ),
  kpi AS (
    SELECT l.per,
           count(*) FILTER (WHERE l.kind = 'sale') AS sales_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'sale'), 0) AS sales_total,
           count(*) FILTER (WHERE l.kind = 'return') AS returns_count,
           -COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'return'), 0) AS returns_total,
           count(*) FILTER (WHERE l.kind = 'exchange') AS exchanges_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'exchange'), 0) AS exchanges_total,
           COALESCE(sum(l.amount), 0) AS net_total
    FROM lines l GROUP BY l.per
  ),
  kpi_src AS (
    SELECT l.per, l.src,
           count(*) FILTER (WHERE l.kind = 'sale') AS sales_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'sale'), 0) AS sales_total,
           COALESCE(sum(l.amount), 0) AS net_total
    FROM lines l GROUP BY l.per, l.src
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
    SELECT l.seller_key,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale') AS cur_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale'), 0) AS cur_sales,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale') AS prev_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale'), 0) AS prev_sales,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev'), 0) AS prev_net
    FROM lines l GROUP BY l.seller_key
  ),
  dayagg AS (
    SELECT CASE WHEN l.per = 'cur' THEN l.d ELSE (l.d + interval '1 year')::date END AS d,
           count(*) FILTER (WHERE l.per = 'cur' AND l.kind = 'sale') AS cur_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'cur'), 0) AS cur_net,
           count(*) FILTER (WHERE l.per = 'prev' AND l.kind = 'sale') AS prev_count,
           COALESCE(sum(l.amount) FILTER (WHERE l.per = 'prev'), 0) AS prev_net
    FROM lines l GROUP BY 1
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to),
    'previous', jsonb_build_object('from', _pf, 'to', _pt),
    'current', COALESCE((SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'cur'),
      jsonb_build_object('sales_count', 0, 'sales_total', 0, 'returns_count', 0, 'returns_total', 0,
                         'exchanges_count', 0, 'exchanges_total', 0, 'net_total', 0)),
    'prior', COALESCE((SELECT to_jsonb(k) - 'per' FROM kpi k WHERE k.per = 'prev'),
      jsonb_build_object('sales_count', 0, 'sales_total', 0, 'returns_count', 0, 'returns_total', 0,
                         'exchanges_count', 0, 'exchanges_total', 0, 'net_total', 0)),
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
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', g.d::date, 'cur_count', COALESCE(a.cur_count, 0), 'cur_net', COALESCE(a.cur_net, 0),
        'prev_count', COALESCE(a.prev_count, 0), 'prev_net', COALESCE(a.prev_net, 0)) ORDER BY g.d)
      FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(d)
      LEFT JOIN dayagg a ON a.d = g.d::date), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_report(uuid, date, date) TO authenticated, service_role;
