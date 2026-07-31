-- 1. Clientes: identificador externo real de Shopify
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

CREATE UNIQUE INDEX IF NOT EXISTS clients_external_unique
  ON public.clients (business_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- 2. Conexión Shopify: una tienda -> un único negocio, inmutable
CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_business_unique
  ON public.shopify_connections (business_id);

CREATE OR REPLACE FUNCTION public.prevent_shopify_connection_rebind()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'La tienda % ya está vinculada a otro negocio y no puede reasignarse', OLD.shop_domain
      USING ERRCODE = '42501';
  END IF;
  IF NEW.shop_domain IS DISTINCT FROM OLD.shop_domain THEN
    RAISE EXCEPTION 'El dominio de la tienda no puede modificarse'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_shopify_connection_rebind ON public.shopify_connections;
CREATE TRIGGER trg_prevent_shopify_connection_rebind
  BEFORE UPDATE ON public.shopify_connections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_shopify_connection_rebind();

-- 3. Operación controlada de reclamación de tienda
CREATE OR REPLACE FUNCTION public.claim_shopify_shop(
  _business_id uuid,
  _shop_domain text,
  _api_version text DEFAULT '2026-07'
)
RETURNS public.shopify_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.shopify_connections;
  v_row public.shopify_connections;
BEGIN
  IF NOT (public.has_min_role(_business_id, 'admin') OR public.is_super_admin()) THEN
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

REVOKE ALL ON FUNCTION public.claim_shopify_shop(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shopify_shop(uuid, text, text) TO authenticated, service_role;

-- 4. Inventario por variante y ubicación
CREATE TABLE IF NOT EXISTS public.shopify_inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  variant_external_id text,
  local_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  local_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  inventory_item_gid text NOT NULL,
  location_gid text NOT NULL,
  location_name text,
  available integer NOT NULL DEFAULT 0,
  external_key text GENERATED ALWAYS AS (inventory_item_gid || '|' || location_gid) STORED,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, inventory_item_gid, location_gid)
);

GRANT SELECT ON public.shopify_inventory_levels TO authenticated;
GRANT ALL ON public.shopify_inventory_levels TO service_role;
ALTER TABLE public.shopify_inventory_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read inventory levels"
  ON public.shopify_inventory_levels FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE TRIGGER trg_shopify_inventory_levels_updated_at
  BEFORE UPDATE ON public.shopify_inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS shopify_inventory_levels_variant_idx
  ON public.shopify_inventory_levels (business_id, variant_external_id);

-- 5. Fulfillments (envíos / preparación)
CREATE TABLE IF NOT EXISTS public.shopify_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.online_orders(id) ON DELETE CASCADE,
  order_external_id text NOT NULL,
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  tracking_number text,
  tracking_company text,
  tracking_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  line_item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_id)
);

GRANT SELECT ON public.shopify_fulfillments TO authenticated;
GRANT ALL ON public.shopify_fulfillments TO service_role;
ALTER TABLE public.shopify_fulfillments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read fulfillments"
  ON public.shopify_fulfillments FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE TRIGGER trg_shopify_fulfillments_updated_at
  BEFORE UPDATE ON public.shopify_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Cola de webhooks: recepción rápida + procesamiento posterior
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS shop_domain text;

CREATE INDEX IF NOT EXISTS integration_webhook_events_pending_idx
  ON public.integration_webhook_events (status, next_attempt_at)
  WHERE status IN ('pending', 'retrying');
