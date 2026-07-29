import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

export interface ProductVariant {
  id: string;
  business_id: string;
  product_id: string;
  name: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  stock_quantity: number;
  is_active: boolean;
}

export interface VariantFormData {
  name: string;
  attributes?: Record<string, string>;
  sku?: string | null;
  barcode?: string | null;
  price?: number | null;
  stock_quantity?: number;
}

export function useProductVariants(productId?: string) {
  const { activeBusiness } = useBusiness();
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchVariants = useCallback(async () => {
    if (!activeBusiness?.id) return;
    setIsLoading(true);

    let query = supabase
      .from('product_variants')
      .select('*')
      .eq('business_id', activeBusiness.id)
      .eq('is_active', true)
      .order('name');

    if (productId) query = query.eq('product_id', productId);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching variants:', error);
      toast.error('Error al cargar variantes');
    } else {
      setVariants(
        (data ?? []).map((v) => ({
          ...v,
          attributes: (v.attributes as Record<string, string>) ?? {},
        })) as ProductVariant[]
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id, productId]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  const createVariant = async (pid: string, data: VariantFormData): Promise<boolean> => {
    if (!activeBusiness?.id) return false;
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('product_variants').insert({
      business_id: activeBusiness.id,
      product_id: pid,
      name: data.name,
      attributes: data.attributes ?? {},
      sku: data.sku || null,
      barcode: data.barcode || null,
      price: data.price ?? null,
      stock_quantity: data.stock_quantity ?? 0,
      created_by: userData.user?.id ?? null,
    });
    setIsSaving(false);

    if (error) {
      console.error('Error creating variant:', error);
      toast.error('Error al crear la variante');
      return false;
    }
    toast.success('Variante creada');
    fetchVariants();
    return true;
  };

  const updateVariant = async (id: string, data: Partial<VariantFormData>): Promise<boolean> => {
    setIsSaving(true);
    const { error } = await supabase.from('product_variants').update(data).eq('id', id);
    setIsSaving(false);

    if (error) {
      console.error('Error updating variant:', error);
      toast.error('Error al actualizar la variante');
      return false;
    }
    fetchVariants();
    return true;
  };

  const deleteVariant = async (id: string): Promise<boolean> => {
    setIsSaving(true);
    const { error } = await supabase
      .from('product_variants')
      .update({ is_active: false })
      .eq('id', id);
    setIsSaving(false);

    if (error) {
      console.error('Error deleting variant:', error);
      toast.error('Error al eliminar la variante');
      return false;
    }
    toast.success('Variante eliminada');
    fetchVariants();
    return true;
  };

  return {
    variants,
    isLoading,
    isSaving,
    createVariant,
    updateVariant,
    deleteVariant,
    refreshVariants: fetchVariants,
  };
}
