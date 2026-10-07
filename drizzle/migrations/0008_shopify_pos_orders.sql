ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS shopify_order_gid text,
  ADD COLUMN IF NOT EXISTS shopify_order_name text,
  ADD COLUMN IF NOT EXISTS shopify_order_status text,
  ADD COLUMN IF NOT EXISTS shopify_order_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shopify_order_error text;

ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS pos_orders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pos_orders_since timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sales_shopify_order_pending
  ON public.sales (business_id, created_at) WHERE shopify_order_gid IS NULL;