-- Envíos del TPV a Shopify fiables, con reintento automático y avisos de fallo.
-- - Sin pedidos duplicados: orderCreate de Shopify no admite clave de idempotencia, así
--   que cada venta se reclama antes de enviarla (claim_pos_sales_for_shopify, FOR UPDATE
--   SKIP LOCKED): dos ejecuciones a la vez nunca cogen la misma venta. Una venta que se
--   queda «enviando» más de 10 minutos (la función se cortó) se puede volver a reclamar, y
--   la función busca antes en Shopify si el pedido ya existe.
-- - Reintento solo: tarea pg_cron «shopify-tpv» cada 5 minutos, con tickets de un solo
--   uso (0026), que llama a shopify-pos-order y shopify-pos-refund si hay trabajo.
-- - Fallos visibles: get_shopify_problems y retry_shopify_problems (administradores).
-- Migración idempotente, sin secretos.

-- 1. Reclamación de ventas ------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS shopify_order_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_pos_sales_for_shopify(_business_id uuid, _limit integer DEFAULT 20)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH c AS (
    SELECT s.id
    FROM sales s
    JOIN shopify_connections sc ON sc.business_id = s.business_id
    WHERE s.business_id = _business_id
      AND sc.pos_orders_enabled
      AND s.created_at >= sc.pos_orders_since
      AND s.shopify_order_gid IS NULL
      AND s.shopify_order_attempts < 5
      AND (
        COALESCE(s.shopify_order_status, 'pending') = 'pending'
        OR (s.shopify_order_status = 'sending' AND s.shopify_order_claimed_at < now() - interval '10 minutes')
      )
    ORDER BY s.created_at
    LIMIT GREATEST(LEAST(COALESCE(_limit, 20), 50), 1)
    FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE sales
  SET shopify_order_status = 'sending', shopify_order_claimed_at = now()
  FROM c
  WHERE sales.id = c.id
  RETURNING sales.id;
$$;
REVOKE ALL ON FUNCTION public.claim_pos_sales_for_shopify(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pos_sales_for_shopify(uuid, integer) TO service_role;

-- 2. ¿Hay ventas o devoluciones del TPV por enviar? (tareas programadas) ---------------
CREATE OR REPLACE FUNCTION public.shopify_pending_pos_work()
RETURNS TABLE(pending_orders boolean, pending_refunds boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM sales s
      JOIN shopify_connections sc ON sc.business_id = s.business_id
      WHERE sc.pos_orders_enabled AND s.created_at >= sc.pos_orders_since
        AND s.shopify_order_gid IS NULL AND s.shopify_order_attempts < 5
        AND (
          COALESCE(s.shopify_order_status, 'pending') = 'pending'
          OR (s.shopify_order_status = 'sending' AND s.shopify_order_claimed_at < now() - interval '10 minutes')
        )
    ),
    EXISTS (
      SELECT 1 FROM sale_returns r
      JOIN sales s ON s.id = r.sale_id
      JOIN shopify_connections sc ON sc.business_id = r.business_id
      WHERE sc.pos_orders_enabled
        AND r.shopify_refund_gid IS NULL AND r.shopify_refund_attempts < 5
        AND r.shopify_refund_status = 'pending'
        AND s.shopify_order_gid IS NOT NULL
    );
$$;
REVOKE ALL ON FUNCTION public.shopify_pending_pos_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_pending_pos_work() TO service_role;

-- 3. Tickets para las nuevas tareas ------------------------------------------------------
ALTER TABLE public.scheduled_job_tickets DROP CONSTRAINT IF EXISTS scheduled_job_tickets_action_check;
ALTER TABLE public.scheduled_job_tickets ADD CONSTRAINT scheduled_job_tickets_action_check
  CHECK (action IN ('process-webhooks', 'refresh-stock', 'push-stock', 'pos-orders', 'pos-refunds'));

-- 4. Fallos visibles y reintento (administradores) --------------------------------------
-- kind: 'venta' | 'devolucion' | 'stock' | 'aviso'; state: 'failed' | 'retrying' | 'waiting'.
CREATE OR REPLACE FUNCTION public.get_shopify_problems(_business_id uuid)
RETURNS TABLE(kind text, state text, record_id uuid, reference text, error text, attempts integer, happened_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_min_role(_business_id, 'admin') OR is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un administrador puede ver los envíos a Shopify' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'venta'::text,
         CASE WHEN s.shopify_order_status = 'failed' THEN 'failed' ELSE 'retrying' END,
         s.id, s.sale_number, s.shopify_order_error, s.shopify_order_attempts, s.created_at
  FROM sales s
  WHERE s.business_id = _business_id AND s.shopify_order_gid IS NULL
    AND (s.shopify_order_status = 'failed' OR (s.shopify_order_attempts > 0 AND s.shopify_order_error IS NOT NULL))
  UNION ALL
  SELECT 'devolucion'::text,
         CASE WHEN r.shopify_refund_status = 'failed' THEN 'failed'
              WHEN s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed' THEN 'waiting'
              ELSE 'retrying' END,
         r.id, r.return_number,
         CASE WHEN s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed'
              THEN 'Esperando a que se envíe su venta ' || s.sale_number
              ELSE r.shopify_refund_error END,
         r.shopify_refund_attempts, r.created_at
  FROM sale_returns r
  JOIN sales s ON s.id = r.sale_id
  WHERE r.business_id = _business_id AND r.shopify_refund_gid IS NULL
    AND (r.shopify_refund_status = 'failed'
         OR (r.shopify_refund_attempts > 0 AND r.shopify_refund_error IS NOT NULL)
         OR (s.shopify_order_gid IS NULL AND s.shopify_order_status = 'failed'))
  UNION ALL
  SELECT 'stock'::text, 'failed', q.id,
         COALESCE(p.name || COALESCE(' · ' || v.name, ''), 'Artículo'),
         q.last_error, q.attempts, q.created_at
  FROM shopify_inventory_pushes q
  LEFT JOIN products p ON p.id = q.local_product_id
  LEFT JOIN product_variants v ON v.id = q.local_variant_id
  WHERE q.business_id = _business_id AND q.status = 'failed'
  UNION ALL
  SELECT 'aviso'::text, 'failed', e.id, e.topic, e.message, e.attempts, e.created_at
  FROM integration_webhook_events e
  WHERE e.business_id = _business_id AND e.integration_key = 'shopify' AND e.status = 'error'
  ORDER BY 7 DESC
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_shopify_problems(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shopify_problems(uuid) TO authenticated, service_role;

-- Vuelve a dejar pendientes los envíos fallidos; la tarea programada los reintenta.
CREATE OR REPLACE FUNCTION public.retry_shopify_problems(_business_id uuid)
RETURNS TABLE(sales_count integer, returns_count integer, stock_count integer, webhooks_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s integer;
  _r integer;
  _q integer;
  _w integer;
BEGIN
  IF NOT (has_min_role(_business_id, 'admin') OR is_super_admin()) THEN
    RAISE EXCEPTION 'Solo un administrador puede reintentar los envíos a Shopify' USING ERRCODE = '42501';
  END IF;

  UPDATE sales
  SET shopify_order_status = 'pending', shopify_order_attempts = 0, shopify_order_claimed_at = NULL
  WHERE business_id = _business_id AND shopify_order_gid IS NULL AND shopify_order_status = 'failed';
  GET DIAGNOSTICS _s = ROW_COUNT;

  UPDATE sale_returns
  SET shopify_refund_status = 'pending', shopify_refund_attempts = 0
  WHERE business_id = _business_id AND shopify_refund_gid IS NULL AND shopify_refund_status = 'failed';
  GET DIAGNOSTICS _r = ROW_COUNT;

  UPDATE shopify_inventory_pushes
  SET status = 'pending', attempts = 0
  WHERE business_id = _business_id AND status = 'failed';
  GET DIAGNOSTICS _q = ROW_COUNT;

  UPDATE integration_webhook_events
  SET status = 'retrying', attempts = 0, next_attempt_at = now()
  WHERE business_id = _business_id AND integration_key = 'shopify' AND status = 'error';
  GET DIAGNOSTICS _w = ROW_COUNT;

  RETURN QUERY SELECT _s, _r, _q, _w;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_shopify_problems(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_shopify_problems(uuid) TO authenticated, service_role;

-- 5. Tarea pg_cron «shopify-tpv» ---------------------------------------------------------
DO $outer$
DECLARE
  -- Proyecto de Supabase de producción (pymova.com).
  _base text := 'https://pmlsgbqlexwffqxvsuaj.supabase.co/functions/v1/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Sin pg_cron o pg_net: no se programa la tarea del TPV';
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT cron.schedule(%L, %L, %L)',
    'shopify-tpv',
    '*/5 * * * *',
    format(
      $job$SELECT
  CASE WHEN w.pending_orders THEN net.http_post(
    url := %L,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('ticket', public.issue_scheduled_job_ticket('pos-orders')),
    timeout_milliseconds := 60000) END,
  CASE WHEN w.pending_refunds THEN net.http_post(
    url := %L,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('ticket', public.issue_scheduled_job_ticket('pos-refunds')),
    timeout_milliseconds := 60000) END
FROM public.shopify_pending_pos_work() w$job$,
      _base || 'shopify-pos-order',
      _base || 'shopify-pos-refund'
    )
  );
END
$outer$;
