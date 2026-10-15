ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS shopify_refund_gid text,
  ADD COLUMN IF NOT EXISTS shopify_refund_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS shopify_refund_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shopify_refund_error text;
CREATE INDEX IF NOT EXISTS idx_sale_returns_shopify_refund_pending
  ON public.sale_returns (business_id) WHERE shopify_refund_gid IS NULL;