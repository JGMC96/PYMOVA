DROP POLICY IF EXISTS "Users can create their own absence requests" ON public.hr_absences;
CREATE POLICY "Users can create their own absence requests" ON public.hr_absences FOR INSERT TO authenticated
WITH CHECK (status = 'pending' AND reviewer_id IS NULL AND reviewed_at IS NULL AND is_member_of_business(business_id) AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_absences.employee_id AND e.business_id = hr_absences.business_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can cancel their own pending absences" ON public.hr_absences;
CREATE POLICY "Users can cancel their own pending absences" ON public.hr_absences FOR UPDATE TO authenticated
USING (status = 'pending' AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_absences.employee_id AND e.business_id = hr_absences.business_id AND e.user_id = auth.uid()))
WITH CHECK (status IN ('pending','cancelled') AND reviewer_id IS NULL AND reviewed_at IS NULL AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_absences.employee_id AND e.business_id = hr_absences.business_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can create their own permission requests" ON public.hr_permissions;
CREATE POLICY "Users can create their own permission requests" ON public.hr_permissions FOR INSERT TO authenticated
WITH CHECK (status = 'pending' AND reviewer_id IS NULL AND reviewed_at IS NULL AND is_member_of_business(business_id) AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_permissions.employee_id AND e.business_id = hr_permissions.business_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can cancel their own pending permissions" ON public.hr_permissions;
CREATE POLICY "Users can cancel their own pending permissions" ON public.hr_permissions FOR UPDATE TO authenticated
USING (status = 'pending' AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_permissions.employee_id AND e.business_id = hr_permissions.business_id AND e.user_id = auth.uid()))
WITH CHECK (status IN ('pending','cancelled') AND reviewer_id IS NULL AND reviewed_at IS NULL AND EXISTS (SELECT 1 FROM public.hr_employees e WHERE e.id = hr_permissions.employee_id AND e.business_id = hr_permissions.business_id AND e.user_id = auth.uid()));