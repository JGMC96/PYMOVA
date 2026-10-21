-- 0037 · Las devoluciones del TPV suman la unidad en Stockagile (piloto TUILUS).
--
-- Stockagile es quien manda en el stock de Tuilus y lo envía a Shopify. Las ventas del TPV
-- ya le llegan (importa el pedido de Shopify), pero las devoluciones no: el 21/10/2026
-- (DEV-000004) PYMOVA y Shopify volvieron a 85 y Stockagile se quedó en 84.
-- - stockagile_connections: negocios conectados a Stockagile (hoy solo TUILUS, dueño del token).
-- - stockagile_stock_moves: cola de movimientos para Stockagile; cada artículo devuelto con
--   reposición añade una fila (+N), una sola vez por línea de devolución.
-- - claim_stockagile_moves: reclama filas sin que dos ejecuciones cojan la misma. Una fila
--   que se quedó «enviando» más de 10 minutos pasa a «por revisar», nunca se reintenta sola:
--   la API de Stockagile no evita duplicados y podría sumarse dos veces.
-- - Tarea pg_cron «stockagile-devoluciones» cada 5 minutos (con ticket) y avisos de fallo
--   en get_shopify_problems (kind 'stockagile').
-- Migración idempotente, sin secretos.

-- 1. Negocios conectados ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stockagile_connections (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stockagile_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stockagile_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stockagile_connections TO authenticated;
GRANT ALL ON public.stockagile_connections TO service_role;
DROP POLICY IF EXISTS "Admins view stockagile connection" ON public.stockagile_connections;
CREATE POLICY "Admins view stockagile connection" ON public.stockagile_connections
  FOR SELECT TO authenticated USING (public.has_min_role(business_id, 'admin'));

-- TUILUS, dueño del token STOCKAGILE_API_TOKEN (solo si el negocio existe).
INSERT INTO public.stockagile_connections (business_id)
SELECT b.id FROM public.businesses b WHERE b.id = 'c84f3b72-ae45-4501-a454-79cf47b888b4'
ON CONFLICT (business_id) DO NOTHING;

-- 2. Cola de movimientos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stockagile_stock_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  local_product_id uuid,
  local_variant_id uuid,
  quantity integer NOT NULL,
  reason text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  stockagile_variant_id bigint,
  warehouse_id bigint,
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stockagile_stock_moves_status_check
    CHECK (status IN ('pending', 'sending', 'done', 'failed', 'review')),
  CONSTRAINT stockagile_stock_moves_source_key UNIQUE (source_table, source_id)
);
CREATE INDEX IF NOT EXISTS stockagile_stock_moves_pending_idx
  ON public.stockagile_stock_moves (business_id, created_at) WHERE status IN ('pending', 'sending');
ALTER TABLE public.stockagile_stock_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stockagile_stock_moves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stockagile_stock_moves TO authenticated;
GRANT ALL ON public.stockagile_stock_moves TO service_role;
DROP POLICY IF EXISTS "Admins view stockagile moves" ON public.stockagile_stock_moves;
CREATE POLICY "Admins view stockagile moves" ON public.stockagile_stock_moves
  FOR SELECT TO authenticated USING (public.has_min_role(business_id, 'admin'));

-- 3. Cada artículo devuelto con reposición, a la cola --------------------------------------
CREATE OR REPLACE FUNCTION public.queue_stockagile_move_on_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
  _restock boolean;
BEGIN
  SELECT r.business_id, r.restock INTO _business_id, _restock
  FROM sale_returns r WHERE r.id = NEW.return_id;

  IF NOT COALESCE(_restock, true) OR COALESCE(NEW.quantity, 0) <= 0 THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM stockagile_connections c WHERE c.business_id = _business_id AND c.enabled
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO stockagile_stock_moves (
    business_id, local_product_id, local_variant_id, quantity, reason, source_table, source_id
  ) VALUES (
    _business_id, NEW.product_id, NEW.variant_id, NEW.quantity::integer, 'return', 'sale_return_items', NEW.id
  )
  ON CONFLICT (source_table, source_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_stockagile_move_on_return_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stockagile_move_on_return_item ON public.sale_return_items;
CREATE TRIGGER trg_stockagile_move_on_return_item
  AFTER INSERT ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION public.queue_stockagile_move_on_return_item();

-- 4. Reclamar movimientos para enviarlos (solo el servidor) --------------------------------
CREATE OR REPLACE FUNCTION public.claim_stockagile_moves(_business_id uuid, _limit integer DEFAULT 20)
RETURNS SETOF public.stockagile_stock_moves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Un envío que no terminó puede haber llegado a Stockagile: se revisa a mano.
  UPDATE stockagile_stock_moves
  SET status = 'review',
      last_error = 'El envío no terminó: puede que ya se haya sumado en Stockagile. Compruébalo allí.'
  WHERE business_id = _business_id AND status = 'sending' AND claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH c AS (
    SELECT m.id FROM stockagile_stock_moves m
    WHERE m.business_id = _business_id AND m.status = 'pending'
    ORDER BY m.created_at
    LIMIT GREATEST(LEAST(COALESCE(_limit, 20), 100), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE stockagile_stock_moves m
  SET status = 'sending', claimed_at = now(), attempts = m.attempts + 1
  FROM c
  WHERE m.id = c.id
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_stockagile_moves(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stockagile_moves(uuid, integer) TO service_role;

-- ¿Hay algo por enviar? (tarea programada)
CREATE OR REPLACE FUNCTION public.stockagile_pending_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM stockagile_stock_moves m
    JOIN stockagile_connections c ON c.business_id = m.business_id AND c.enabled
    WHERE m.status = 'pending'
       OR (m.status = 'sending' AND m.claimed_at < now() - interval '10 minutes')
  );
$$;
REVOKE ALL ON FUNCTION public.stockagile_pending_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stockagile_pending_work() TO service_role;

-- 5. Ticket para la nueva tarea ------------------------------------------------------------
ALTER TABLE public.scheduled_job_tickets DROP CONSTRAINT IF EXISTS scheduled_job_tickets_action_check;
ALTER TABLE public.scheduled_job_tickets ADD CONSTRAINT scheduled_job_tickets_action_check
  CHECK (action IN ('process-webhooks', 'refresh-stock', 'push-stock', 'pos-orders', 'pos-refunds', 'stockagile-push'));

-- 6. Avisos de fallo y reintento (cuerpo de la 0032 más Stockagile) ------------------------
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
  UNION ALL
  SELECT 'stockagile'::text, 'failed', m.id,
         COALESCE(p.name || COALESCE(' · ' || v.name, ''), 'Artículo') || ' (+' || m.quantity || ')',
         m.last_error, m.attempts, m.created_at
  FROM stockagile_stock_moves m
  LEFT JOIN products p ON p.id = m.local_product_id
  LEFT JOIN product_variants v ON v.id = m.local_variant_id
  WHERE m.business_id = _business_id AND m.status IN ('failed', 'review')
  ORDER BY 7 DESC
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_shopify_problems(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shopify_problems(uuid) TO authenticated, service_role;

-- Reintentar: los «por revisar» no se tocan (pueden haberse sumado ya en Stockagile).
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
  _m integer;
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

  UPDATE stockagile_stock_moves
  SET status = 'pending', attempts = 0, claimed_at = NULL
  WHERE business_id = _business_id AND status = 'failed';
  GET DIAGNOSTICS _m = ROW_COUNT;

  UPDATE integration_webhook_events
  SET status = 'retrying', attempts = 0, next_attempt_at = now()
  WHERE business_id = _business_id AND integration_key = 'shopify' AND status = 'error';
  GET DIAGNOSTICS _w = ROW_COUNT;

  RETURN QUERY SELECT _s, _r, _q + _m, _w;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_shopify_problems(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_shopify_problems(uuid) TO authenticated, service_role;

-- 7. Tarea pg_cron «stockagile-devoluciones» ---------------------------------------------
DO $outer$
DECLARE
  -- Proyecto de Supabase de producción (pymova.com).
  _base text := 'https://pmlsgbqlexwffqxvsuaj.supabase.co/functions/v1/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Sin pg_cron o pg_net: no se programa la tarea de Stockagile';
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT cron.schedule(%L, %L, %L)',
    'stockagile-devoluciones',
    '*/5 * * * *',
    format(
      $job$SELECT net.http_post(
    url := %L,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('ticket', public.issue_scheduled_job_ticket('stockagile-push')),
    timeout_milliseconds := 60000)
WHERE public.stockagile_pending_work()$job$,
      _base || 'stockagile'
    )
  );
END
$outer$;