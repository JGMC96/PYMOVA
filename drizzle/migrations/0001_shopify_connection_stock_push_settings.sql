ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS default_location_gid text,
  ADD COLUMN IF NOT EXISTS stock_push_enabled boolean NOT NULL DEFAULT true;