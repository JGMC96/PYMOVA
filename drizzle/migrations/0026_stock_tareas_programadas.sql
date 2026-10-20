-- Tareas programadas de stock con Shopify.
-- - Cada 5 minutos: si hay avisos de Shopify o envíos de stock pendientes, se procesan.
-- - Cada noche (03:00 UTC): se refresca el stock completo desde Shopify (refresh-stock).
-- Sin secretos: antes de cada llamada, la tarea crea un ticket aleatorio de un solo uso
-- (scheduled_job_tickets) y lo manda en el cuerpo. La edge function solo atiende la
-- llamada si el ticket existe, es de esa acción, no se ha usado y tiene menos de 10 min.
-- Si no existen pg_cron o pg_net (por ejemplo, en la base de tests), las tareas no se
-- crean. Migración idempotente: cron.schedule reemplaza la tarea por nombre.

-- 1. Último refresco de stock, visible en la integración ---------------------------
ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS last_stock_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_stock_refresh_status text;

-- 2. ¿Hay trabajo pendiente? (solo service_role y tareas programadas) ---------------
CREATE OR REPLACE FUNCTION public.shopify_pending_work()
RETURNS TABLE(pending_pushes boolean, pending_events boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM shopify_inventory_pushes q
      WHERE q.status = 'pending' AND q.attempts < 5
    ),
    EXISTS (
      SELECT 1 FROM integration_webhook_events e
      WHERE e.status IN ('pending', 'retrying')
        AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= now())
    );
$$;

REVOKE ALL ON FUNCTION public.shopify_pending_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_pending_work() TO service_role;

-- 3. Tickets de un solo uso para las tareas programadas ------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_job_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('process-webhooks', 'refresh-stock', 'push-stock')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
ALTER TABLE public.scheduled_job_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_job_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.scheduled_job_tickets TO service_role;

-- Crea un ticket. La llaman las tareas pg_cron (que se ejecutan como su propietario).
CREATE OR REPLACE FUNCTION public.issue_scheduled_job_ticket(_action text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
BEGIN
  DELETE FROM scheduled_job_tickets WHERE created_at < now() - interval '1 day';
  INSERT INTO scheduled_job_tickets (action) VALUES (_action) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_scheduled_job_ticket(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_scheduled_job_ticket(text) TO service_role;

-- La edge function lo gasta: devuelve true una sola vez, si es de esa acción y reciente.
CREATE OR REPLACE FUNCTION public.consume_scheduled_job_ticket(_ticket uuid, _action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE scheduled_job_tickets
  SET used_at = now()
  WHERE id = _ticket
    AND action = _action
    AND used_at IS NULL
    AND created_at > now() - interval '10 minutes';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_scheduled_job_ticket(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_scheduled_job_ticket(uuid, text) TO service_role;

-- 4. Tareas pg_cron ------------------------------------------------------------------
DO $outer$
DECLARE
  -- Proyecto de Supabase de producción (pymova.com).
  _base text := 'https://pmlsgbqlexwffqxvsuaj.supabase.co/functions/v1/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Sin pg_cron o pg_net: no se programan las tareas de stock';
    RETURN;
  END IF;

  -- Colas: avisos de Shopify y envíos de stock, solo si hay algo pendiente.
  EXECUTE format(
    'SELECT cron.schedule(%L, %L, %L)',
    'shopify-colas',
    '*/5 * * * *',
    format(
      $job$SELECT
  CASE WHEN w.pending_events THEN net.http_post(
    url := %L,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('action', 'process-webhooks', 'limit', 50,
      'ticket', public.issue_scheduled_job_ticket('process-webhooks')),
    timeout_milliseconds := 60000) END,
  CASE WHEN w.pending_pushes THEN net.http_post(
    url := %L,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('ticket', public.issue_scheduled_job_ticket('push-stock')),
    timeout_milliseconds := 60000) END
FROM public.shopify_pending_work() w$job$,
      _base || 'shopify-sync',
      _base || 'shopify-inventory-push'
    )
  );

  -- Refresco completo del stock cada noche.
  EXECUTE format(
    'SELECT cron.schedule(%L, %L, %L)',
    'shopify-stock-nocturno',
    '0 3 * * *',
    format(
      $job$SELECT net.http_post(
  url := %L,
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := jsonb_build_object('action', 'refresh-stock',
    'ticket', public.issue_scheduled_job_ticket('refresh-stock')),
  timeout_milliseconds := 120000)$job$,
      _base || 'shopify-sync'
    )
  );
END
$outer$;
