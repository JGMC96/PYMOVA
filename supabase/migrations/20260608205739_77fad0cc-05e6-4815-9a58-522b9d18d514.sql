
CREATE POLICY "Members can view profiles of business teammates"
ON public.profiles FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members bm_self
    JOIN public.business_members bm_other
      ON bm_other.business_id = bm_self.business_id
    WHERE bm_self.user_id = auth.uid()
      AND bm_self.is_active = true
      AND bm_other.user_id = profiles.id
      AND bm_other.is_active = true
  )
);
