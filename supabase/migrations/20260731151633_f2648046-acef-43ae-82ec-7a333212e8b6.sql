ALTER TABLE public.online_order_returns
  ADD COLUMN IF NOT EXISTS external_refund_id text,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_sync_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS external_sync_error text,
  ADD COLUMN IF NOT EXISTS external_synced_at timestamptz;