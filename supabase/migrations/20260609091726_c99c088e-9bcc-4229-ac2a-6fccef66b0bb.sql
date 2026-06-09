
-- Fix 1: Bug in businesses SELECT policy (self-referential always-true)
DROP POLICY IF EXISTS "Members can view their businesses" ON public.businesses;
CREATE POLICY "Members can view their businesses"
ON public.businesses
FOR SELECT
TO authenticated
USING (is_member_of_business(id));

-- Fix 2: Restrict sales / sale_items policies to authenticated role
DROP POLICY IF EXISTS "Members can view sales" ON public.sales;
CREATE POLICY "Members can view sales" ON public.sales
FOR SELECT TO authenticated
USING (is_member_of_business(business_id));

DROP POLICY IF EXISTS "Members can create sales" ON public.sales;
CREATE POLICY "Members can create sales" ON public.sales
FOR INSERT TO authenticated
WITH CHECK (is_member_of_business(business_id));

DROP POLICY IF EXISTS "Owner/Admin can delete sales" ON public.sales;
CREATE POLICY "Owner/Admin can delete sales" ON public.sales
FOR DELETE TO authenticated
USING (has_min_role(business_id, 'admin'::app_role));

DROP POLICY IF EXISTS "Members can manage sale items" ON public.sale_items;
CREATE POLICY "Members can manage sale items" ON public.sale_items
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_items.sale_id AND is_member_of_business(sales.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_items.sale_id AND is_member_of_business(sales.business_id)));

DROP POLICY IF EXISTS "Members can view sale items" ON public.sale_items;
CREATE POLICY "Members can view sale items" ON public.sale_items
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_items.sale_id AND is_member_of_business(sales.business_id)));

-- Fix 3: Revoke EXECUTE on SECURITY DEFINER application functions from anon/public
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'create_payment_and_recalc_invoice','ensure_hr_employee',
        'get_employee_monthly_report','request_absence','get_hr_dashboard',
        'request_permission','create_invoice_with_items','generate_sale_number',
        'clock_action','review_absence','is_super_admin','has_platform_role',
        'get_recent_activity','review_permission','has_business_role',
        'set_active_business','generate_invoice_number','is_member_of_business',
        'get_user_role_in_business','has_min_role','get_dashboard_metrics'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon', fn.proname, fn.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', fn.proname, fn.args);
  END LOOP;
END $$;
