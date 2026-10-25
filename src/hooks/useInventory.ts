import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import type { ProductVariant } from './useProductVariants';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchCatalogCosts, VARIANT_COLUMNS, type CatalogCosts } from '@/lib/catalogCosts';
import { hasStockLeft } from '@/lib/posSearch';

export interface ProductWithStock {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string | null;
  category: string | null;
  is_active: boolean;
  stock_quantity: number;
  track_inventory: boolean;
  barcode: string | null;
  sku: string | null;
  /** Color del producto en Shopify (custom.color), para las etiquetas. */
  color?: string | null;
  variants: ProductVariant[];
}

/**
 * Catálogo con stock y tallas. Sin coste salvo `withCosts` (solo con permiso de ver costes):
 * entonces se piden aparte y se añaden a cada talla. Con `inactiveWithStock` (solo el TPV),
 * también los productos inactivos en Shopify que aún tienen stock en la tienda (0053).
 */
export function useInventory({
  withCosts = false,
  inactiveWithStock = false,
}: { withCosts?: boolean; inactiveWithStock?: boolean } = {}) {
  const { activeBusiness } = useBusiness();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [costs, setCosts] = useState<CatalogCosts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!activeBusiness?.id) return;

    setIsLoading(true);
    const businessId = activeBusiness.id;
    const [{ data, error }, { data: variantData, error: variantError }] = await Promise.all([
      // `color` es de la 0042: se lee sin tipos hasta que se regenere types.ts.
      fetchAllRows<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('products')
          .select('id, name, description, price, unit, category, is_active, stock_quantity, track_inventory, barcode, sku, color' as '*')
          .eq('business_id', businessId);
        if (!inactiveWithStock) q = q.eq('is_active', true);
        return q
          .order('name')
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
      }),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('product_variants')
          .select(VARIANT_COLUMNS as '*')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('name')
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
      ),
    ]);

    if (error || variantError) {
      console.error('Error fetching products:', error ?? variantError);
      toast.error('Error al cargar productos');
    } else {
      const variants = variantData.map((v) => ({
        ...v,
        attributes: (v.attributes as Record<string, string>) ?? {},
      })) as unknown as ProductVariant[];
      const byProduct = new Map<string, ProductVariant[]>();
      for (const v of variants) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);

      const all = data.map((p) => ({
        ...p,
        stock_quantity: (p.stock_quantity as number | null) ?? 0,
        track_inventory: (p.track_inventory as boolean | null) ?? false,
        color: (p.color as string | null | undefined) ?? null,
        variants: byProduct.get(p.id as string) ?? [],
      })) as unknown as ProductWithStock[];
      // Inactivos solo si les queda stock; los activos, siempre.
      setProducts(inactiveWithStock ? all.filter((p) => p.is_active || hasStockLeft(p)) : all);
    }
    setIsLoading(false);
  }, [activeBusiness?.id, inactiveWithStock]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const businessId = activeBusiness?.id;
    if (!withCosts || !businessId) {
      setCosts(null);
      return;
    }
    let cancelled = false;
    void fetchCatalogCosts(supabase, businessId).then(({ costs: c, error }) => {
      if (error) console.error('Error fetching costs:', error);
      if (!cancelled) setCosts(c);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBusiness?.id, withCosts]);

  const withCostPrices = useMemo(
    () =>
      costs
        ? products.map((p) => ({
            ...p,
            variants: p.variants.map((v) => ({ ...v, cost_price: costs.variants.get(v.id) ?? null })),
          }))
        : products,
    [products, costs],
  );

  // El stock se cambia con useStockAdjust (adjust_stock, solo admins y con motivo).

  const toggleTracking = async (productId: string, trackInventory: boolean): Promise<boolean> => {
    setIsUpdating(true);
    const { error } = await supabase
      .from('products')
      .update({ track_inventory: trackInventory })
      .eq('id', productId);

    setIsUpdating(false);

    if (error) {
      console.error('Error updating tracking:', error);
      toast.error('Error al actualizar seguimiento');
      return false;
    }

    toast.success(trackInventory ? 'Seguimiento activado' : 'Seguimiento desactivado');
    fetchProducts();
    return true;
  };

  return {
    products: withCostPrices,
    isLoading,
    isUpdating,
    toggleTracking,
    refreshProducts: fetchProducts,
  };
}
