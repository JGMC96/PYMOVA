ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS cost_price numeric;
COMMENT ON COLUMN public.products.cost_price IS 'Coste unitario del producto (COGS) para calcular margen y POAS';
COMMENT ON COLUMN public.product_variants.cost_price IS 'Coste unitario de la variante (COGS)';