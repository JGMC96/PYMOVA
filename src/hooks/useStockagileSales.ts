// Ventas de la tienda hechas en Stockagile (0046): copia de consulta, de 50 en 50.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { stockagileTicketCode } from '@/lib/ticketCode';

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
const SALE_COLUMNS =
  'id, number, sold_at, total, is_return, payment_methods, customer_name, client_id, clients(name), stockagile_sale_items(id, product_name, quantity, total)';
/** Tope de tickets que devuelve una búsqueda por el principio del número. */
export const STOCKAGILE_SEARCH_LIMIT = 20;

/**
 * Tickets de Stockagile cuyo número empieza por lo escrito o escaneado (en toda la copia, no
 * solo en los cargados). En los antiguos sin «VT», el número es el id de Stockagile, que
 * también se mira por si el código de barras del ticket lo lleva.
 */
export async function findStockagileTickets(businessId: string, input: string): Promise<StockagileSale[] | null> {
  const code = stockagileTicketCode(input);
  if (!code) return [];
  // `code` solo tiene letras y cifras: se puede poner tal cual en el filtro. Solo cifras
  // puede ser un ticket antiguo, su id o un «VT…» escrito sin las letras.
  const filter = /^\d+$/.test(code)
    ? `number.like.${code}*,number.like.VT${code}*,external_id.eq.${code}`
    : `number.like.${code}*`;
  const { data, error } = await supabase
    .from('stockagile_sales' as never)
    .select(SALE_COLUMNS)
    .eq('business_id', businessId)
    .eq('deleted', false)
    .or(filter)
    .order('sold_at', { ascending: false })
    .limit(STOCKAGILE_SEARCH_LIMIT);
  if (error) return null;
  return (data ?? []) as unknown as StockagileSale[];
}

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
        .select(SALE_COLUMNS)
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
