import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';

export interface MonthlyReportRow {
  id: string;
  session_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  worked_seconds: number;
  break_seconds: number;
  status: 'open' | 'closed';
  needs_review: boolean;
  correction_reason: string | null;
}

export interface SessionCorrection {
  clockInAt: Date;
  clockOutAt: Date;
  breakSeconds: number;
  reason: string;
}

export function useHrReports(employeeId: string | null, year: number, month: number) {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();
  const [rows, setRows] = useState<MonthlyReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const fetchReport = useCallback(async () => {
    if (!activeBusinessId || !employeeId) {
      setRows([]);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_employee_monthly_report', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _year: year,
        _month: month,
      });
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;
      // id, needs_review y correction_reason llegan con la 0020; types.ts se regenera después.
      setRows((data || []) as unknown as MonthlyReportRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, employeeId, year, month]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  /** Corrige una sesión (solo admins). El motivo queda en la auditoría. */
  const correctSession = useCallback(
    async (sessionId: string, c: SessionCorrection): Promise<boolean> => {
      // RPC nueva de la 0020: `as never` hasta que se regenere types.ts.
      const { error } = await supabase.rpc('correct_work_session' as never, {
        _session_id: sessionId,
        _clock_in_at: c.clockInAt.toISOString(),
        _clock_out_at: c.clockOutAt.toISOString(),
        _break_seconds: c.breakSeconds,
        _reason: c.reason,
      } as never);
      if (error) {
        toast({ title: 'No se pudo corregir', description: error.message, variant: 'destructive' });
        return false;
      }
      toast({ title: 'Fichaje corregido' });
      await fetchReport();
      return true;
    },
    [fetchReport, toast],
  );

  return { rows, isLoading, refresh: fetchReport, correctSession };
}
