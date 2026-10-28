// Productos y tallas (todas, también las inactivas) con sus códigos, para «Códigos con
// problemas». Solo las columnas de códigos: nada de coste (0052).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { codeRows, type CodeProduct, type CodeRow, type CodeVariant } from '@/lib/codeProblems';

const PRODUCT_CODE_COLUMNS = 'id, name, is_active, sku, barcode, external_source';
const VARIANT_CODE_COLUMNS = 'id, product_id, name, sku, barcode, is_active';

export function useCodeProblems() {
  const { activeBusinessId } = useBusiness();
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusinessId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const [products, variants] = await Promise.all([
      fetchAllRows<CodeProduct>((from, to) =>
        supabase
          .from('products')
          .select(PRODUCT_CODE_COLUMNS as '*')
          .eq('business_id', activeBusinessId)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: CodeProduct[] | null; error: unknown }>,
      ),
      fetchAllRows<CodeVariant>((from, to) =>
        supabase
          .from('product_variants')
          .select(VARIANT_CODE_COLUMNS as '*')
          .eq('business_id', activeBusinessId)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: CodeVariant[] | null; error: unknown }>,
      ),
    ]);
    if (products.error || variants.error) {
      console.error('códigos con problemas', products.error ?? variants.error);
      setError('No se han podido leer los productos.');
      setRows([]);
    } else {
      setRows(codeRows(products.data, variants.data));
    }
    setIsLoading(false);
  }, [activeBusinessId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, isLoading, error, reload: load };
}
