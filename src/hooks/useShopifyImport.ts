import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { fetchShopifyProducts, type ShopifyProduct } from '@/lib/shopify';

export interface ImportSummary {
  created: number;
  updated: number;
  variants: number;
  failed: number;
}

function hasRealVariants(product: ShopifyProduct) {
  const variants = product.variants.edges.map((e) => e.node);
  return variants.length > 1 || (variants[0] && variants[0].title !== 'Default Title');
}

export function useShopifyImport() {
  const { activeBusinessId, user } = useBusiness();

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const requestIdRef = useRef(0);

  const search = useCallback(async (query: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchShopifyProducts({ first: 50, query });
      if (requestId !== requestIdRef.current) return;
      setProducts(page.products);
      setHasNextPage(page.hasNextPage);
      setCursor(page.endCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setError(message);
      setProducts([]);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async (query: string) => {
    if (!hasNextPage || !cursor) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const page = await fetchShopifyProducts({ first: 50, after: cursor, query });
      if (requestId !== requestIdRef.current) return;
      setProducts((prev) => [...prev, ...page.products]);
      setHasNextPage(page.hasNextPage);
      setCursor(page.endCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [cursor, hasNextPage]);

  const importProducts = useCallback(
    async (selected: ShopifyProduct[]): Promise<ImportSummary | null> => {
      if (!activeBusinessId) {
        toast.error('Selecciona un negocio activo antes de importar.');
        return null;
      }
      if (selected.length === 0) return null;

      setIsImporting(true);
      const summary: ImportSummary = { created: 0, updated: 0, variants: 0, failed: 0 };

      try {
        const names = selected.map((p) => p.title);
        const { data: existing } = await supabase
          .from('products')
          .select('id, name')
          .eq('business_id', activeBusinessId)
          .in('name', names);

        const existingByName = new Map((existing ?? []).map((p) => [p.name, p.id]));

        for (const product of selected) {
          try {
            const variants = product.variants.edges.map((e) => e.node);
            const firstVariant = variants[0];
            const price = Number(product.priceRange.minVariantPrice.amount) || 0;

            const payload = {
              business_id: activeBusinessId,
              name: product.title,
              description: product.description?.slice(0, 2000) || null,
              price,
              category: product.productType || null,
              sku: firstVariant?.sku || null,
              barcode: firstVariant?.barcode || null,
              track_inventory: false,
              is_active: true,
            };

            const existingId = existingByName.get(product.title);
            let productId: string;

            if (existingId) {
              const { error: updateError } = await supabase
                .from('products')
                .update(payload)
                .eq('id', existingId)
                .eq('business_id', activeBusinessId);
              if (updateError) throw updateError;
              productId = existingId;
              summary.updated += 1;
            } else {
              const { data: inserted, error: insertError } = await supabase
                .from('products')
                .insert({ ...payload, created_by: user?.id ?? null })
                .select('id')
                .single();
              if (insertError) throw insertError;
              productId = inserted.id;
              summary.created += 1;
            }

            if (hasRealVariants(product)) {
              const { data: currentVariants } = await supabase
                .from('product_variants')
                .select('id, name')
                .eq('business_id', activeBusinessId)
                .eq('product_id', productId);

              const variantByName = new Map((currentVariants ?? []).map((v) => [v.name, v.id]));

              for (const variant of variants) {
                const attributes = Object.fromEntries(
                  variant.selectedOptions.map((o) => [o.name, o.value]),
                );
                const variantPayload = {
                  business_id: activeBusinessId,
                  product_id: productId,
                  name: variant.title,
                  attributes,
                  sku: variant.sku || null,
                  barcode: variant.barcode || null,
                  price: Number(variant.price.amount) || null,
                  is_active: variant.availableForSale,
                };

                const currentId = variantByName.get(variant.title);
                if (currentId) {
                  await supabase
                    .from('product_variants')
                    .update(variantPayload)
                    .eq('id', currentId)
                    .eq('business_id', activeBusinessId);
                } else {
                  await supabase
                    .from('product_variants')
                    .insert({ ...variantPayload, created_by: user?.id ?? null });
                }
                summary.variants += 1;
              }
            }
          } catch (err) {
            console.error('Error importando producto de Shopify:', product.title, err);
            summary.failed += 1;
          }
        }

        setLastSummary(summary);
        if (summary.failed > 0) {
          toast.warning(
            `Importación parcial: ${summary.created} creados, ${summary.updated} actualizados, ${summary.failed} con error.`,
          );
        } else {
          toast.success(
            `Importados ${summary.created + summary.updated} productos (${summary.variants} variantes).`,
          );
        }
        return summary;
      } finally {
        setIsImporting(false);
      }
    },
    [activeBusinessId, user?.id],
  );

  return {
    products,
    isLoading,
    isImporting,
    error,
    hasNextPage,
    lastSummary,
    search,
    loadMore,
    importProducts,
  };
}
