-- Cola de correo: solo el servidor puede usarla.
-- En producción, enqueue_email, read_email_batch, delete_email, move_to_dlq,
-- email_queue_dispatch y email_queue_wake son SECURITY DEFINER y anon y authenticated
-- podían ejecutarlas (la migración de la cola solo quitaba PUBLIC, pero Supabase da
-- EXECUTE a anon y authenticated por defecto). Con la clave pública de la web se podían
-- encolar correos con el remitente de la app o leer los correos en cola (que incluyen
-- enlaces de invitación). Las usan solo las edge functions con la clave de servicio
-- (send-transactional-email, process-email-queue) y pg_cron como postgres.
-- email_queue_dispatch y email_queue_wake las crea la herramienta de correo de Lovable
-- fuera de las migraciones: se tratan solo si existen.
-- Además, el estado 'rate_limited' que escribe process-email-queue no estaba en el CHECK
-- de email_send_log y ese registro se perdía.
-- Migración idempotente.

DO $$
DECLARE
  _fn text;
BEGIN
  FOREACH _fn IN ARRAY ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.email_queue_dispatch()',
    'public.email_queue_wake()'
  ] LOOP
    IF to_regprocedure(_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', _fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _fn);
    END IF;
  END LOOP;

  IF to_regclass('public.email_send_log') IS NOT NULL THEN
    ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
    ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
      CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'rate_limited'));
  END IF;
END
$$;
