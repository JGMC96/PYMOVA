import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/types/database';

export interface ProductFormData {
  name: string;
  description?: string;
  price: number;
  cost_price?: number | null;
  unit?: string;
  category?: string;
}

interface UseProductsReturn {
  products: Product[];
  isLoading: boolean;
  error: Error | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  showInactive: boolean;
  setShowInactive: (show: boolean) => void;
  fetchProducts: () => Promise<void>;
  createProduct: (data: ProductFormData) => Promise<boolean>;
  updateProduct: (id: string, data: ProductFormData) => Promise<boolean>;
  toggleProductStatus: (id: string, currentStatus: boolean) => Promise<boolean>;
}

// Normalize data before saving
function normalizeProductData(data: ProductFormData): ProductFormData {
  return {
    name: data.name.trim(),
    description: data.description?.trim() || undefined,
    price: Number(data.price),
    cost_price:
      data.cost_price === undefined || data.cost_price === null || Number.isNaN(Number(data.cost_price))
        ? null
        : Number(data.cost_price),
    unit: data.unit?.trim() || undefined,
    category: data.category?.trim() || undefined,
  };
}

// Sanitize search term to prevent .or() parsing issues
function sanitizeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[,();]/g, ' ') // Replace filter-breaking chars with space
    .replace(/\s+/g, ' ')    // Collapse multiple spaces
    .trim();
}

export function useProducts(): UseProductsReturn {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  
  // Request ID counter for race condition protection
  const requestIdRef = useRef(0);

  // Single unified fetch function with race condition protection
  const runFetch = useCallback(async (requestId: number) => {
    if (!activeBusinessId) {
      if (requestId === requestIdRef.current) {
        setProducts([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      let query = supabase
        .from('products')
        .select('*')
        .eq('business_id', activeBusinessId)
        .order('name', { ascending: true });

      // Filter by active status
      if (!showInactive) {
        query = query.eq('is_active', true);
      }

      // Search filter using OR for multiple columns
      const sanitizedTerm = sanitizeSearchTerm(searchTerm);
      if (sanitizedTerm) {
        query = query.or(
          `name.ilike.%${sanitizedTerm}%,category.ilike.%${sanitizedTerm}%`
        );
      }

      const { data, error: fetchError } = await query;

      // Only update state if this is still the current request
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (fetchError) {
        throw fetchError;
      }

      setProducts(data || []);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      
      console.error('Error fetching products:', err);
      setError(err instanceof Error ? err : new Error('Error al cargar productos'));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeBusinessId, searchTerm, showInactive]);

  // Public fetch function that increments request ID
  const fetchProducts = useCallback(async () => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    await runFetch(newRequestId);
  }, [runFetch]);

  // Effect for initial load and dependency changes
  useEffect(() => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    runFetch(newRequestId);
  }, [runFetch]);

  // Create product
  const createProduct = useCallback(async (data: ProductFormData): Promise<boolean> => {
    if (!activeBusinessId || !user) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const normalizedData = normalizeProductData(data);
      
      const { error: insertError } = await supabase
        .from('products')
        .insert({
          business_id: activeBusinessId,
          created_by: user.id,
          name: normalizedData.name,
          description: normalizedData.description || null,
          price: normalizedData.price,
          unit: normalizedData.unit || null,
          category: normalizedData.category || null,
        });

      if (insertError) {
        throw insertError;
      }

      toast({
        title: 'Producto creado',
        description: 'El producto se ha creado correctamente',
      });

      await fetchProducts();
      return true;
    } catch (err) {
      console.error('Error creating product:', err);
      toast({
        title: 'Error al crear producto',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, user, fetchProducts, toast]);

  // Update product
  const updateProduct = useCallback(async (id: string, data: ProductFormData): Promise<boolean> => {
    if (!activeBusinessId) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const normalizedData = normalizeProductData(data);
      
      const { error: updateError } = await supabase
        .from('products')
        .update({
          name: normalizedData.name,
          description: normalizedData.description || null,
          price: normalizedData.price,
          unit: normalizedData.unit || null,
          category: normalizedData.category || null,
        })
        .eq('id', id)
        .eq('business_id', activeBusinessId);

      if (updateError) {
        throw updateError;
      }

      toast({
        title: 'Producto actualizado',
        description: 'Los cambios se han guardado correctamente',
      });

      await fetchProducts();
      return true;
    } catch (err) {
      console.error('Error updating product:', err);
      toast({
        title: 'Error al actualizar',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, fetchProducts, toast]);

  // Toggle product status (soft delete/reactivate) - NO DELETE FUNCTION EXISTS
  const toggleProductStatus = useCallback(async (id: string, currentStatus: boolean): Promise<boolean> => {
    if (!activeBusinessId) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    const newStatus = !currentStatus;
    const action = newStatus ? 'reactivado' : 'desactivado';

    try {
      const { error: updateError } = await supabase
        .from('products')
        .update({ is_active: newStatus })
        .eq('id', id)
        .eq('business_id', activeBusinessId);

      if (updateError) {
        throw updateError;
      }

      toast({
        title: `Producto ${action}`,
        description: `El producto ha sido ${action} correctamente`,
      });

      await fetchProducts();
      return true;
    } catch (err) {
      console.error('Error toggling product status:', err);
      toast({
        title: `Error al ${newStatus ? 'reactivar' : 'desactivar'}`,
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, fetchProducts, toast]);

  return {
    products,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    showInactive,
    setShowInactive,
    fetchProducts,
    createProduct,
    updateProduct,
    toggleProductStatus,
    // NOTE: No deleteProduct function - only soft delete via toggleProductStatus
  };
}
