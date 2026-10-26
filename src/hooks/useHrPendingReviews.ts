import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import { correctWorkSession, type MonthlyReportRow, type SessionCorrection } from '@/hooks/useHrReports';

export interface PendingReviewRow extends MonthlyReportRow {
  employee_id: string;
  employee_name: string;
}

/**
 * Jornadas que un administrador tiene que revisar: pendientes de revisión o abiertas hace
 * más de 12 h (salida olvidada). Solo se piden si `enabled` (la RPC rechaza al personal).
 */
export function useHrPendingReviews(enabled: boolean) {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();
  const [rows, setRows] = useState<PendingReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const fetchRows = useCallback(async () => {
    if (!activeBusinessId || !enabled) {
      setRows([]);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      // RPC nueva de la 0056: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('get_hr_pending_reviews' as never, {
        _business_id: activeBusinessId,
      } as never);
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;
      setRows((data || []) as unknown as PendingReviewRow[]);
    } catch (err) {
      console.error('useHrPendingReviews', err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, enabled]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const closeSession = useCallback(
    async (sessionId: string, c: SessionCorrection): Promise<boolean> => {
      const error = await correctWorkSession(sessionId, c);
      if (error) {
        toast({ title: 'No se pudo cerrar la jornada', description: error, variant: 'destructive' });
        return false;
      }
      toast({ title: 'Jornada cerrada' });
      await fetchRows();
      return true;
    },
    [fetchRows, toast],
  );

  return { rows, isLoading, refresh: fetchRows, closeSession };
}
