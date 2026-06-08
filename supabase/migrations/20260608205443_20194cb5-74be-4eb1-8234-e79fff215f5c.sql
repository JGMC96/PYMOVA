
-- Marketing module catalog entry
INSERT INTO public.modules (key, name, description, is_active, display_order)
VALUES ('marketing', 'Calendario de marketing', 'Planifica y coordina publicaciones del equipo de marketing (historia, post, reel)', true, 80)
ON CONFLICT (key) DO NOTHING;

-- Attach marketing module to pro and business plans
INSERT INTO public.plan_modules (plan_id, module_id, limits)
SELECT p.id, m.id, '{}'::jsonb
FROM public.plans p
CROSS JOIN public.modules m
WHERE m.key = 'marketing'
  AND p.key IN ('pro','business')
ON CONFLICT DO NOTHING;

-- marketing_posts table
CREATE TABLE public.marketing_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  copy text,
  content_type text NOT NULL CHECK (content_type IN ('story','post','reel')),
  channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','draft','scheduled','published','cancelled')),
  scheduled_at timestamptz,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reference_url text,
  hashtags text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_posts_business_scheduled ON public.marketing_posts (business_id, scheduled_at);
CREATE INDEX idx_marketing_posts_business_status ON public.marketing_posts (business_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_posts TO authenticated;
GRANT ALL ON public.marketing_posts TO service_role;

ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view marketing posts"
ON public.marketing_posts FOR SELECT TO authenticated
USING (public.is_member_of_business(business_id));

CREATE POLICY "Admins can insert marketing posts"
ON public.marketing_posts FOR INSERT TO authenticated
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE POLICY "Admins can update marketing posts"
ON public.marketing_posts FOR UPDATE TO authenticated
USING (public.has_min_role(business_id, 'admin'))
WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE POLICY "Admins can delete marketing posts"
ON public.marketing_posts FOR DELETE TO authenticated
USING (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER update_marketing_posts_updated_at
BEFORE UPDATE ON public.marketing_posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_marketing_posts
AFTER INSERT OR UPDATE OR DELETE ON public.marketing_posts
FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
