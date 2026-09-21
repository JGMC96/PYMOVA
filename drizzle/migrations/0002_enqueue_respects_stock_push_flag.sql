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
  IF NOT EXISTS (
    SELECT 1 FROM shopify_connections
    WHERE business_id = _business_id AND stock_push_enabled = true
  ) THEN
    RETURN;
  END IF;

  INSERT INTO shopify_inventory_pushes (
    business_id, local_product_id, local_variant_id, delta, reason, source_table, source_id
  ) VALUES (
    _business_id, _product_id, _variant_id, _delta, _reason, _source_table, _source_id
  );
END;
$$;