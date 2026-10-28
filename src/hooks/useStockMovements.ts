import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export type StockMovementSource =
  | 'sale'
  | 'return'
  | 'online_order'
  | 'shopify'
  | 'import'
  | 'manual'
  | 'initial'
  | 'purchase'
  | 'other';

export const STOCK_SOURCE_LABEL: Record<StockMovementSource, string> = {
  sale: 'Venta en tienda',
  return: 'Devolución',
  online_order: 'Pedido online',
  shopify: 'Shopify',
  import: 'Importación',
  manual: 'Ajuste',
  initial: 'Alta',
  purchase: 'Compra',
  other: 'Otro',
};

export interface StockMovement {
  id: string;
  created_at: string;
  product_id: string | null;
  product_name: string | null;
  variant_id: string | null;
  variant_name: string | null;
  delta: number;
  stock_after: number | null;
  source: StockMovementSource;
  note: string | null;
  /** La persona del PIN o la cuenta; null si lo hizo Shopify, Stockagile o una tarea. */
  who: string | null;
}

/**
 * Últimos movimientos de stock del negocio (get_stock_movements, 0057), de un producto si se
 * indica y de un origen si se filtra. Solo lectura, para los miembros del negocio.
 * `reloadKey`: al cambiar, se vuelve a cargar (tras un ajuste, por ejemplo).
 */
export function useStockMovements(
  productId: string | null,
  source: StockMovementSource | null = null,
  { limit = 50, reloadKey = 0 }: { limit?: number; reloadKey?: number } = {},
) {
  const { activeBusinessId } = useBusiness();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchMovements = useCallback(async () => {
    if (!activeBusinessId) return;
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);
    // RPC nueva de la 0057: `as never` hasta que se regenere types.ts.
    const { data, error: rpcError } = await supabase.rpc('get_stock_movements' as never, {
      _business_id: activeBusinessId,
      _product_id: productId,
      _source: source,
      _limit: limit,
    } as never);
    if (id !== requestId.current) return;
    setIsLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      setMovements([]);
    } else {
      setMovements((data ?? []) as StockMovement[]);
    }
  }, [activeBusinessId, productId, source, limit]);

  // reloadKey solo fuerza una carga nueva.
  useEffect(() => {
    void fetchMovements();
  }, [fetchMovements, reloadKey]);

  return { movements, isLoading, error, refresh: fetchMovements };
}
