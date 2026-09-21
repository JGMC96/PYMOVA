CREATE TABLE IF NOT EXISTS public.shopify_inventory_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  local_product_id uuid,
  local_variant_id uuid,
  delta integer NOT NULL,
  reason text NOT NULL,
  source_table text,
  source_id uuid,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  inventory_item_gid text,
  location_gid text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shopify_inventory_pushes TO authenticated;
GRANT ALL ON public.shopify_inventory_pushes TO service_role;
ALTER TABLE public.shopify_inventory_pushes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read inventory pushes"
  ON public.shopify_inventory_pushes FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE TRIGGER trg_shopify_inventory_pushes_updated_at
  BEFORE UPDATE ON public.shopify_inventory_pushes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS shopify_inventory_pushes_pending_idx
  ON public.shopify_inventory_pushes (business_id, status, created_at);

CREATE OR REPLACE FUNCTION public.enqueue_shopify_inventory_push(
  _business_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _delta integer,
  _reason text,
  _source_table text,
  _source_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _delta = 0 OR _business_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM shopify_connections WHERE business_id = _business_id) THEN
    RETURN;
  END IF;

  INSERT INTO shopify_inventory_pushes (
    business_id, local_product_id, local_variant_id, delta, reason, source_table, source_id
  ) VALUES (
    _business_id, _product_id, _variant_id, _delta, _reason, _source_table, _source_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_shopify_inventory_push(uuid, uuid, uuid, integer, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_shopify_inventory_push(uuid, uuid, uuid, integer, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_shopify_push_on_sale_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
BEGIN
  SELECT business_id INTO _business_id FROM sales WHERE id = NEW.sale_id;
  PERFORM public.enqueue_shopify_inventory_push(
    _business_id, NEW.product_id, NEW.variant_id,
    -NEW.quantity::integer, 'sale', 'sale_items', NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shopify_push_on_sale_item ON public.sale_items;
CREATE TRIGGER trg_shopify_push_on_sale_item
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_push_on_sale_item();

CREATE OR REPLACE FUNCTION public.queue_shopify_push_on_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business_id uuid;
  _restock boolean;
BEGIN
  SELECT business_id, restock INTO _business_id, _restock
  FROM sale_returns WHERE id = NEW.return_id;

  IF NOT COALESCE(_restock, true) THEN RETURN NEW; END IF;

  PERFORM public.enqueue_shopify_inventory_push(
    _business_id, NEW.product_id, NEW.variant_id,
    NEW.quantity::integer, 'return', 'sale_return_items', NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shopify_push_on_return_item ON public.sale_return_items;
CREATE TRIGGER trg_shopify_push_on_return_item
  AFTER INSERT ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_push_on_return_item();