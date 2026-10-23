import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { fetchCatalogCosts, VARIANT_COLUMNS, type CatalogCosts } from '@/lib/catalogCosts';

export interface ProductVariant {
  id: string;
  business_id: string;
  product_id: string;
  name: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  cost_price: number | null;
  stock_quantity: number;
  is_active: boolean;
}

export interface VariantFormData {
  name: string;
  attributes?: Record<string, string>;
  sku?: string | null;
  barcode?: string | null;
  price?: number | null;
  cost_price?: number | null;
  stock_quantity?: number;
}

/** Tallas de un producto (o del negocio). Sin coste salvo `withCosts` (permiso de ver costes). */
export function useProductVariants(productId?: string, { withCosts = false }: { withCosts?: boolean } = {}) {
  const { activeBusiness } = useBusiness();
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [costs, setCosts] = useState<CatalogCosts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchVariants = useCallback(async () => {
    if (!activeBusiness?.id) return;
    setIsLoading(true);

    let query = supabase
      .from('product_variants')
      .select(VARIANT_COLUMNS as '*')
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
        ((data ?? []) as unknown as ProductVariant[]).map((v) => ({
          ...v,
          attributes: (v.attributes as Record<string, string>) ?? {},
        })) as ProductVariant[]
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id, productId]);

  const fetchCosts = useCallback(async () => {
    if (!withCosts || !activeBusiness?.id) {
      setCosts(null);
      return;
    }
    const { costs: c, error } = await fetchCatalogCosts(supabase, activeBusiness.id, productId);
    if (error) console.error('Error fetching costs:', error);
    setCosts(error ? null : c);
  }, [activeBusiness?.id, productId, withCosts]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  useEffect(() => {
    void fetchCosts();
  }, [fetchCosts]);

  const variantsWithCosts = useMemo(
    () => variants.map((v) => ({ ...v, cost_price: costs?.variants.get(v.id) ?? null })),
    [variants, costs],
  );

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
      // Sin ver costes, la talla nueva se crea sin coste.
      cost_price: costs !== null ? (data.cost_price ?? null) : null,
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
    void fetchCosts();
    return true;
  };

  const updateVariant = async (id: string, data: Partial<VariantFormData>): Promise<boolean> => {
    setIsSaving(true);
    // Sin ver costes no se toca el coste que tenga.
    const { cost_price, ...rest } = data;
    const payload = costs !== null && cost_price !== undefined ? { ...rest, cost_price } : rest;
    const { error } = await supabase.from('product_variants').update(payload).eq('id', id);
    setIsSaving(false);

    if (error) {
      console.error('Error updating variant:', error);
      toast.error('Error al actualizar la variante');
      return false;
    }
    fetchVariants();
    void fetchCosts();
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
    variants: variantsWithCosts,
    isLoading,
    isSaving,
    createVariant,
    updateVariant,
    deleteVariant,
    refreshVariants: fetchVariants,
  };
}
