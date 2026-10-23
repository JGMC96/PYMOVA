-- Revisión de seguridad del 23/10/2026.
--
-- 1. Pedidos web: solo por RPC. Hasta ahora cualquier miembro podía crear, cambiar o borrar
--    pedidos, líneas y devoluciones web directamente por la API (importes, estado o la marca
--    `stock_applied`, que decide si el stock ya se descontó), saltándose create_online_order,
--    set_online_order_status y create_online_order_return. La app ya usa solo esas RPC, y
--    Shopify escribe con el rol de servicio, así que no cambia nada en pantalla.
-- 2. Permisos de funciones: sin sesión no se ejecuta ninguna función privilegiada. Las de
--    trigger siguen funcionando (Postgres no comprueba EXECUTE al dispararlas).
-- 3. search_path fijo en los cuatro triggers de protección.

-- 1. Pedidos web ---------------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_create_online_orders ON public.online_orders;
DROP POLICY IF EXISTS staff_update_online_orders ON public.online_orders;
DROP POLICY IF EXISTS admins_delete_online_orders ON public.online_orders;
DROP POLICY IF EXISTS staff_write_online_order_items ON public.online_order_items;
DROP POLICY IF EXISTS staff_update_online_order_items ON public.online_order_items;
DROP POLICY IF EXISTS admins_delete_online_order_items ON public.online_order_items;
DROP POLICY IF EXISTS staff_create_online_returns ON public.online_order_returns;
DROP POLICY IF EXISTS admins_delete_online_returns ON public.online_order_returns;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.online_orders, public.online_order_items, public.online_order_returns
  FROM anon, authenticated;

-- 2. Funciones -----------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_online_order(uuid, jsonb, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_online_order(uuid, jsonb, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_online_order_status(uuid, public.online_order_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_online_order_status(uuid, public.online_order_status, text) TO authenticated, service_role;

-- La usa la política de alta de negocios: hace falta para `authenticated`, no sin sesión.
REVOKE ALL ON FUNCTION public.owned_business_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owned_business_count(uuid) TO authenticated, service_role;

-- Funciones de trigger: nadie las llama directamente.
DO $$
DECLARE _f regprocedure;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f);
  END LOOP;
END $$;

-- 3. search_path fijo ----------------------------------------------------------------------------
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['protect_catalog_writes', 'protect_document_counters', 'protect_document_number', 'protect_member_identity'] LOOP
    IF to_regprocedure(format('public.%I()', _f)) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I() SET search_path = public', _f);
    END IF;
  END LOOP;
END $$;
