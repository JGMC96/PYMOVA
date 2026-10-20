-- Tareas programadas de stock con Shopify.
-- - Cada 5 minutos: si hay avisos de Shopify o envíos de stock pendientes, se procesan.
-- - Cada noche (03:00 UTC): se refresca el stock completo desde Shopify (refresh-stock).
-- Las tareas llaman a las edge functions con la clave de servicio guardada en el vault
-- (secreto 'email_queue_service_role_key', creado por Lovable para la cola de correo).
-- El valor del secreto nunca aparece aquí: se lee dentro de la propia tarea.
-- Si no existen pg_cron, pg_net o el secreto (por ejemplo, en la base de tests), las
-- tareas no se crean. Migración idempotente: cron.schedule reemplaza la tarea por nombre.

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

-- 3. Tareas pg_cron ------------------------------------------------------------------
DO $outer$
DECLARE
  _has_secret boolean := false;
  -- Proyecto de Supabase de producción (pymova.com).
  _base text := 'https://pmlsgbqlexwffqxvsuaj.supabase.co/functions/v1/';
  _headers text := $h$jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'))$h$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR to_regclass('vault.secrets') IS NULL THEN
    RAISE NOTICE 'Sin pg_cron, pg_net o vault: no se programan las tareas de stock';
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = ''email_queue_service_role_key'')'
    INTO _has_secret;
  IF NOT _has_secret THEN
    RAISE NOTICE 'Falta el secreto email_queue_service_role_key en el vault: no se programan las tareas de stock';
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
    headers := %s,
    body := jsonb_build_object('action', 'process-webhooks', 'limit', 50),
    timeout_milliseconds := 60000) END,
  CASE WHEN w.pending_pushes THEN net.http_post(
    url := %L,
    headers := %s,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000) END
FROM public.shopify_pending_work() w$job$,
      _base || 'shopify-sync', _headers,
      _base || 'shopify-inventory-push', _headers
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
  headers := %s,
  body := jsonb_build_object('action', 'refresh-stock'),
  timeout_milliseconds := 120000)$job$,
      _base || 'shopify-sync', _headers
    )
  );
END
$outer$;
