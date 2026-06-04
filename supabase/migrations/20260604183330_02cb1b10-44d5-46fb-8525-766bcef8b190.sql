
DROP POLICY IF EXISTS "Members can manage invoice items" ON public.invoice_items;

CREATE POLICY "Members can insert invoice items"
ON public.invoice_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.invoices
  WHERE invoices.id = invoice_items.invoice_id
    AND public.is_member_of_business(invoices.business_id)
));

CREATE POLICY "Members can update invoice items"
ON public.invoice_items FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices
  WHERE invoices.id = invoice_items.invoice_id
    AND public.is_member_of_business(invoices.business_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.invoices
  WHERE invoices.id = invoice_items.invoice_id
    AND public.is_member_of_business(invoices.business_id)
));

CREATE POLICY "Owner/Admin can delete invoice items"
ON public.invoice_items FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices
  WHERE invoices.id = invoice_items.invoice_id
    AND public.has_min_role(invoices.business_id, 'admin'::app_role)
));
