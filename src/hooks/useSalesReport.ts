import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import type { LiveSalesReport, SalesChannel } from '@/lib/informes';

/** Cada cuánto se vuelve a pedir un informe que incluye hoy. */
export const LIVE_REFRESH_MS = 60_000;

/**
 * Ventas de tienda y online del periodo, comparadas con el año anterior (RPC de la 0064: solo
 * el propietario y quien tenga «Ver ventas»). Con `live`, se actualiza solo cada minuto mientras
 * la pestaña está a la vista.
 */
export function useSalesReport(from: string, to: string, channel: SalesChannel, options: { enabled: boolean; live: boolean }) {
  const { activeBusinessId, user } = useBusiness();
  return useQuery({
    queryKey: ['sales-report', user?.id, activeBusinessId, from, to, channel],
    enabled: options.enabled && !!activeBusinessId && !!from && !!to && from <= to,
    refetchInterval: options.live ? LIVE_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    // Al cambiar de periodo se ve el anterior atenuado en vez de una pantalla vacía.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === user?.id && previousQuery?.queryKey[2] === activeBusinessId ? previous : undefined,
    queryFn: async () => {
      // RPC nueva de la 0064: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('get_sales_report_v2' as never, {
        _business_id: activeBusinessId,
        _from: from,
        _to: to,
        _channel: channel,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as LiveSalesReport;
    },
  });
}
