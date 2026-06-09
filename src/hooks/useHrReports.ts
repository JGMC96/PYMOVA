import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export interface MonthlyReportRow {
  session_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  worked_seconds: number;
  break_seconds: number;
  status: 'open' | 'closed';
}

export function useHrReports(employeeId: string | null, year: number, month: number) {
  const { activeBusinessId } = useBusiness();
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
      const { data, error } = await (supabase.rpc as any)('get_employee_monthly_report', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _year: year,
        _month: month,
      });
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;
      setRows((data || []) as MonthlyReportRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, employeeId, year, month]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return { rows, isLoading, refresh: fetchReport };
}
