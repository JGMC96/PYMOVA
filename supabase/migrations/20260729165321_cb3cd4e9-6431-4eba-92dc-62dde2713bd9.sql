CREATE TABLE public.integration_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  requested_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, integration_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_interests TO authenticated;
GRANT ALL ON public.integration_interests TO service_role;

ALTER TABLE public.integration_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_view_integration_interests"
ON public.integration_interests FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE POLICY "members_add_integration_interests"
ON public.integration_interests FOR INSERT TO authenticated
WITH CHECK (public.is_member_of_business(business_id) AND requested_by = auth.uid());

CREATE POLICY "members_update_integration_interests"
ON public.integration_interests FOR UPDATE TO authenticated
USING (public.is_member_of_business(business_id) OR public.is_super_admin())
WITH CHECK (public.is_member_of_business(business_id) OR public.is_super_admin());

CREATE POLICY "members_remove_integration_interests"
ON public.integration_interests FOR DELETE TO authenticated
USING (requested_by = auth.uid() OR public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE TRIGGER update_integration_interests_updated_at
BEFORE UPDATE ON public.integration_interests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();