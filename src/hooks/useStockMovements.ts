import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StockMovementSource =
  | 'sale'
  | 'return'
  | 'online_order'
  | 'shopify'
  | 'import'
  | 'manual'
  | 'initial'
  | 'other';

export const STOCK_SOURCE_LABEL: Record<StockMovementSource, string> = {
  sale: 'Venta en tienda',
  return: 'Devolución',
  online_order: 'Pedido online',
  shopify: 'Shopify',
  import: 'Importación',
  manual: 'Ajuste manual',
  initial: 'Alta',
  other: 'Otro',
};

export interface StockMovement {
  id: string;
  delta: number;
  stock_after: number | null;
  source: StockMovementSource;
  note: string | null;
  created_at: string;
  variant_id: string | null;
  variant_name: string | null;
}

interface MovementRow extends Omit<StockMovement, 'variant_name'> {
  product_variants: { name: string } | null;
}

type MovementsResult = Promise<{ data: MovementRow[] | null; error: { message: string } | null }>;
interface MovementsQuery {
  select(columns: string): MovementsQuery;
  eq(column: string, value: string): MovementsQuery;
  order(column: string, options: { ascending: boolean }): MovementsQuery;
  limit(count: number): MovementsResult;
}

// `stock_movements` llega con la migración 0024; types.ts se regenera después.
const fromMovements = () =>
  (supabase.from.bind(supabase) as unknown as (table: string) => MovementsQuery)('stock_movements');

/** Últimos movimientos de stock de un producto (y de sus variantes). Solo lectura. */
export function useStockMovements(productId: string | null, limit = 50) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(async () => {
    if (!productId) {
      setMovements([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    const { data, error: queryError } = await fromMovements()
      .select('id, delta, stock_after, source, note, created_at, variant_id, product_variants(name)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (queryError) {
      setError(queryError.message);
      setMovements([]);
    } else {
      setMovements(
        (data ?? []).map(({ product_variants, ...row }) => ({
          ...row,
          variant_name: product_variants?.name ?? null,
        })),
      );
    }
    setIsLoading(false);
  }, [productId, limit]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  return { movements, isLoading, error, refresh: fetchMovements };
}
