// Ventas de la tienda hechas en Stockagile (0046): copia de consulta, de 50 en 50.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export interface StockagileSaleItem {
  id: string;
  product_name: string;
  quantity: number;
  total: number | null;
}

export interface StockagileSale {
  id: string;
  number: string | null;
  sold_at: string;
  total: number;
  is_return: boolean;
  payment_methods: string | null;
  customer_name: string | null;
  client_id: string | null;
  clients: { name: string } | null;
  stockagile_sale_items: StockagileSaleItem[];
}

const PAGE = 50;

/** Mensaje de error de una edge function (el cuerpo trae `{ error }`). */
export async function functionError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  try {
    const body = await ctx?.clone().json();
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // sin cuerpo JSON
  }
  return (error as { message?: string } | null)?.message || fallback;
}

export function useStockagileSales(enabled: boolean) {
  const { activeBusinessId } = useBusiness();
  const [sales, setSales] = useState<StockagileSale[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset = 0) => {
      if (!enabled || !activeBusinessId) return;
      const id = ++requestId.current;
      setIsLoading(true);
      // Tablas de la 0046: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase
        .from('stockagile_sales' as never)
        .select('id, number, sold_at, total, is_return, payment_methods, customer_name, client_id, clients(name), stockagile_sale_items(id, product_name, quantity, total)')
        .eq('business_id', activeBusinessId)
        .eq('deleted', false)
        .order('sold_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (id !== requestId.current) return;
      setIsLoading(false);
      if (error) {
        toast.error('No se pudieron cargar las ventas de Stockagile');
        return;
      }
      const rows = (data ?? []) as unknown as StockagileSale[];
      setSales((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE);
    },
    [enabled, activeBusinessId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  /** Trae ya los tickets recientes de Stockagile (la tarea lo hace sola cada 5 minutos). */
  const syncNow = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsSyncing(true);
    const { error } = await supabase.functions.invoke('stockagile', {
      body: { action: 'import-sales', business_id: activeBusinessId },
    });
    setIsSyncing(false);
    if (error) {
      toast.error(await functionError(error, 'No se pudieron traer las ventas de Stockagile'));
      return;
    }
    await load(0);
  }, [activeBusinessId, load]);

  return { sales, hasMore, isLoading, isSyncing, loadMore: () => load(sales.length), syncNow };
}
