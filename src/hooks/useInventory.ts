import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import type { ProductVariant } from './useProductVariants';

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

const PAGE = 1000;

/**
 * Todas las filas de una consulta, de 1.000 en 1.000: el servidor no devuelve más de 1.000
 * por petición y un negocio puede tener más tallas (Tuilus pasa de 1.200).
 */
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

export function useInventory() {
  const { activeBusiness } = useBusiness();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!activeBusiness?.id) return;

    setIsLoading(true);
    const businessId = activeBusiness.id;
    const [{ data, error }, { data: variantData, error: variantError }] = await Promise.all([
      // `color` es de la 0042: se lee sin tipos hasta que se regenere types.ts.
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('products')
          .select('id, name, description, price, unit, category, is_active, stock_quantity, track_inventory, barcode, sku, color' as '*')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('name')
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
      ),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('product_variants')
          .select('*')
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

      setProducts(
        data.map((p) => ({
          ...p,
          stock_quantity: (p.stock_quantity as number | null) ?? 0,
          track_inventory: (p.track_inventory as boolean | null) ?? false,
          color: (p.color as string | null | undefined) ?? null,
          variants: byProduct.get(p.id as string) ?? [],
        })) as unknown as ProductWithStock[]
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
    products,
    isLoading,
    isUpdating,
    toggleTracking,
    refreshProducts: fetchProducts,
  };
}
