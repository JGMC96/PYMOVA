ALTER TABLE public.integration_sync_runs
  ADD COLUMN IF NOT EXISTS total_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.integration_sync_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.integration_sync_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'product',
  entity_name text NOT NULL,
  external_id text,
  attempts integer NOT NULL DEFAULT 1,
  error_message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_sync_issues TO authenticated;
GRANT ALL ON public.integration_sync_issues TO service_role;

ALTER TABLE public.integration_sync_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view sync issues"
  ON public.integration_sync_issues FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE POLICY "Admins can insert sync issues"
  ON public.integration_sync_issues FOR INSERT TO authenticated
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can update sync issues"
  ON public.integration_sync_issues FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can delete sync issues"
  ON public.integration_sync_issues FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_sync_issues_run ON public.integration_sync_issues(run_id);
CREATE INDEX IF NOT EXISTS idx_sync_issues_business ON public.integration_sync_issues(business_id, created_at DESC);

CREATE TRIGGER update_integration_sync_issues_updated_at
  BEFORE UPDATE ON public.integration_sync_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();