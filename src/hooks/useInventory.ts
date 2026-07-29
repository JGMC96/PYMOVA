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
  variants: ProductVariant[];
}

export function useInventory() {
  const { activeBusiness } = useBusiness();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!activeBusiness?.id) return;

    setIsLoading(true);
    const [{ data, error }, { data: variantData, error: variantError }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, description, price, unit, category, is_active, stock_quantity, track_inventory, barcode, sku')
        .eq('business_id', activeBusiness.id)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('product_variants')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('is_active', true)
        .order('name'),
    ]);

    if (error || variantError) {
      console.error('Error fetching products:', error ?? variantError);
      toast.error('Error al cargar productos');
    } else {
      const variants = (variantData ?? []).map((v) => ({
        ...v,
        attributes: (v.attributes as Record<string, string>) ?? {},
      })) as ProductVariant[];

      setProducts(
        (data ?? []).map((p) => ({
          ...p,
          stock_quantity: p.stock_quantity ?? 0,
          track_inventory: p.track_inventory ?? false,
          variants: variants.filter((v) => v.product_id === p.id),
        })) as ProductWithStock[]
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const updateStock = async (productId: string, newQuantity: number): Promise<boolean> => {
    setIsUpdating(true);
    const { error } = await supabase
      .from('products')
      .update({ stock_quantity: newQuantity })
      .eq('id', productId);

    setIsUpdating(false);

    if (error) {
      console.error('Error updating stock:', error);
      toast.error('Error al actualizar stock');
      return false;
    }

    toast.success('Stock actualizado');
    fetchProducts();
    return true;
  };

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
    updateStock,
    toggleTracking,
    refreshProducts: fetchProducts,
  };
}
