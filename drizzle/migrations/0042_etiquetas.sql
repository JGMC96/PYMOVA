-- Etiquetas de producto, como el diseñador de Stockagile: diseños guardados por negocio
-- (hoja o rollo, y campos con su tamaño, alineación, estilos y orden), y el color del
-- producto para imprimirlo.
--
-- · products.color: el color del producto en Shopify (metacampo custom.color, p. ej.
--   «Piel Negro»). Lo escribe la sincronización del catálogo.
-- · label_templates: los diseños. Los ven los miembros del negocio (para imprimir) y los
--   cambian quienes pueden ajustar stock. La configuración es un JSON que valida la app.

-- 1. Color del producto ---------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color text;

-- 2. Diseños de etiqueta ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 32768),
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_name_key ON public.label_templates (business_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_default_key ON public.label_templates (business_id) WHERE is_default;

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.label_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_templates TO authenticated;
GRANT ALL ON public.label_templates TO service_role;

DROP POLICY IF EXISTS "Members view label templates" ON public.label_templates;
CREATE POLICY "Members view label templates" ON public.label_templates
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));
DROP POLICY IF EXISTS "Stock managers create label templates" ON public.label_templates;
CREATE POLICY "Stock managers create label templates" ON public.label_templates
  FOR INSERT TO authenticated WITH CHECK (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers update label templates" ON public.label_templates;
CREATE POLICY "Stock managers update label templates" ON public.label_templates
  FOR UPDATE TO authenticated
  USING (public.member_can(business_id, 'adjust_stock'))
  WITH CHECK (public.member_can(business_id, 'adjust_stock'));
DROP POLICY IF EXISTS "Stock managers delete label templates" ON public.label_templates;
CREATE POLICY "Stock managers delete label templates" ON public.label_templates
  FOR DELETE TO authenticated USING (public.member_can(business_id, 'adjust_stock'));
