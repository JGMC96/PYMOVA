-- Auditoría de seguridad del 23/10/2026: S1 (refuerzo) y S3.
--
-- 1. shopify_connections solo se escribe desde el servidor. La app no la toca nunca: la
--    vinculación va por shopify-sync (acción «claim») y el resto de cambios los hacen las
--    edge functions con el rol de servicio. Hasta ahora un admin de cualquier negocio podía
--    crear, cambiar o borrar conexiones por la API (con un dominio cualquiera) y llamar a
--    claim_shopify_shop directamente. Desde la PR #68 las funciones ya exigen el dominio de la
--    tienda del despliegue; esto cierra además la escritura.
-- 2. claim_shopify_shop solo la ejecuta el servicio. shopify-sync comprueba antes que quien
--    vincula es admin del negocio (o super admin) y que la tienda es la del despliegue.
-- 3. enqueue_shopify_inventory_push deja de estar abierta a cualquier usuario con sesión: no
--    comprobaba la pertenencia ni los ids, y permitía mandar a Shopify cambios de stock sin
--    pasar por adjust_stock. Solo la usan funciones SECURITY DEFINER y triggers, que se
--    ejecutan como propietario y no necesitan el permiso.

-- 1. shopify_connections sin escrituras desde la app ----------------------------------------------
DROP POLICY IF EXISTS "Admins can insert shopify connections" ON public.shopify_connections;
DROP POLICY IF EXISTS "Admins can update shopify connections" ON public.shopify_connections;
DROP POLICY IF EXISTS "Admins can delete shopify connections" ON public.shopify_connections;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shopify_connections FROM anon, authenticated;

-- 2. Vincular la tienda: solo el servicio ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_shopify_shop(_business_id uuid, _shop_domain text, _api_version text DEFAULT '2026-07'::text)
RETURNS shopify_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing public.shopify_connections;
  v_row public.shopify_connections;
BEGIN
  -- Defensa adicional: aunque solo el servicio tenga permiso de ejecución, cualquier otro
  -- llamante tendría que ser admin del negocio.
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (public.has_min_role(_business_id, 'admin') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Necesitas permisos de administrador en este negocio' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.shopify_connections WHERE shop_domain = _shop_domain;

  IF FOUND THEN
    IF v_existing.business_id <> _business_id THEN
      RAISE EXCEPTION 'La tienda % ya está vinculada a otro negocio', _shop_domain
        USING ERRCODE = '42501';
    END IF;
    RETURN v_existing;
  END IF;

  IF EXISTS (SELECT 1 FROM public.shopify_connections WHERE business_id = _business_id) THEN
    RAISE EXCEPTION 'Este negocio ya tiene una tienda de Shopify vinculada' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shopify_connections (business_id, shop_domain, api_version, created_by)
  VALUES (_business_id, _shop_domain, _api_version, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_shopify_shop(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shopify_shop(uuid, text, text) TO service_role;

-- 3. Cola de stock hacia Shopify: sin acceso directo ----------------------------------------------
REVOKE ALL ON FUNCTION public.enqueue_shopify_inventory_push(uuid, uuid, uuid, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_shopify_inventory_push(uuid, uuid, uuid, integer, text, text, uuid)
  TO service_role;
