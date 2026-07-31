CREATE TABLE IF NOT EXISTS public.shopify_app_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL UNIQUE,
  access_token text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.shopify_app_tokens FROM anon, authenticated;
GRANT ALL ON public.shopify_app_tokens TO service_role;

ALTER TABLE public.shopify_app_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No client access to shopify tokens"
  ON public.shopify_app_tokens
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE TRIGGER update_shopify_app_tokens_updated_at
  BEFORE UPDATE ON public.shopify_app_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS api_version text NOT NULL DEFAULT '2026-07',
  ADD COLUMN IF NOT EXISTS granted_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_catalog_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS uninstalled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS integration_webhook_events_unique_event
  ON public.integration_webhook_events (integration_key, event_id)
  WHERE event_id IS NOT NULL;