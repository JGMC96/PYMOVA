-- 1. Pin search_path on SECURITY DEFINER queue helpers (bodies are already schema-qualified)
ALTER FUNCTION public.move_to_dlq(text,text,int8,jsonb) SET search_path = '';
ALTER FUNCTION public.read_email_batch(text,int4,int4) SET search_path = '';
ALTER FUNCTION public.enqueue_email(text,jsonb) SET search_path = '';
ALTER FUNCTION public.delete_email(text,int8) SET search_path = '';

-- 2. Only owners may grant or revoke the owner role; admins are capped below owner
DROP POLICY IF EXISTS "Owner/Admin can update members" ON public.business_members;
CREATE POLICY "Owner/Admin can update members"
ON public.business_members FOR UPDATE
TO authenticated
USING (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role <> 'owner'::app_role)
)
WITH CHECK (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role <> 'owner'::app_role)
);

DROP POLICY IF EXISTS "Owner/Admin can insert members" ON public.business_members;
CREATE POLICY "Owner/Admin can insert members"
ON public.business_members FOR INSERT
TO authenticated
WITH CHECK (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role <> 'owner'::app_role)
  OR (
    -- Alta inicial: el creador del negocio se registra como propietario
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.business_members existing
      WHERE existing.business_id = business_members.business_id
    )
  )
);

-- 3. Business creation is scoped to the caller and bounded, not "any signed-in user"
CREATE OR REPLACE FUNCTION public.owned_business_count(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.business_members bm
  WHERE bm.user_id = _user_id
    AND bm.role = 'owner'::public.app_role
$$;

GRANT EXECUTE ON FUNCTION public.owned_business_count(uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can create businesses" ON public.businesses;
CREATE POLICY "Users can create their own businesses"
ON public.businesses FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND public.owned_business_count(auth.uid()) < 10
);

-- 4. plan_modules: solo los planes relevantes para el usuario, no todo el catálogo
DROP POLICY IF EXISTS "Authenticated users can view plan modules" ON public.plan_modules;
CREATE POLICY "Users can view modules of their own plans"
ON public.plan_modules FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = plan_modules.plan_id
      AND p.key = 'trial'
  )
  OR EXISTS (
    SELECT 1
    FROM public.subscriptions s
    JOIN public.business_members bm ON bm.business_id = s.business_id
    WHERE s.plan_id = plan_modules.plan_id
      AND bm.user_id = auth.uid()
      AND bm.is_active
  )
);