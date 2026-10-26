import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import type { SalesReport } from '@/lib/informes';

/** Informe de ventas del periodo y del mismo periodo del año anterior (RPC solo para el propietario). */
export function useSalesReport(from: string, to: string, enabled = true) {
  const { activeBusinessId } = useBusiness();
  return useQuery({
    queryKey: ['sales-report', activeBusinessId, from, to],
    enabled: enabled && !!activeBusinessId && !!from && !!to && from <= to,
    queryFn: async () => {
      // RPC nueva de la 0055: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('get_sales_report' as never, {
        _business_id: activeBusinessId,
        _from: from,
        _to: to,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as SalesReport;
    },
  });
}
