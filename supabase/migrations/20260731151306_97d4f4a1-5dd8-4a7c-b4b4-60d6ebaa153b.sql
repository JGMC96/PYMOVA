ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_external
  ON public.products(business_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_external
  ON public.product_variants(business_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.integration_variant_mismatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.integration_sync_runs(id) ON DELETE CASCADE,
  integration_key text NOT NULL DEFAULT 'shopify',
  product_name text NOT NULL,
  variant_name text,
  sku text,
  barcode text,
  external_id text,
  local_variant_id uuid,
  issue_code text NOT NULL,
  external_stock integer,
  local_stock integer,
  details text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_variant_mismatches TO authenticated;
GRANT ALL ON public.integration_variant_mismatches TO service_role;

ALTER TABLE public.integration_variant_mismatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view variant mismatches"
  ON public.integration_variant_mismatches FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE POLICY "Admins can insert variant mismatches"
  ON public.integration_variant_mismatches FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can update variant mismatches"
  ON public.integration_variant_mismatches FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can delete variant mismatches"
  ON public.integration_variant_mismatches FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_variant_mismatches_business
  ON public.integration_variant_mismatches(business_id, created_at DESC);

CREATE TRIGGER update_integration_variant_mismatches_updated_at
  BEFORE UPDATE ON public.integration_variant_mismatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();