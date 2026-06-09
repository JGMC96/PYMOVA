import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { HrSchedule } from '@/types/database';

export function useSchedules(monthDate: Date) {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<HrSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setSchedules([]);
      setIsLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      const { data, error } = await (supabase
        .from('hr_schedules' as any)
        .select('*')
        .eq('business_id', activeBusinessId)
        .gte('shift_date', start.toISOString().slice(0, 10))
        .lte('shift_date', end.toISOString().slice(0, 10))
        .order('shift_date', { ascending: true }) as any);
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;
      setSchedules((data || []) as HrSchedule[]);
    } catch (err) {
      console.error(err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, monthDate]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createSchedule = useCallback(
    async (employee_id: string, shift_date: string, start_time: string, end_time: string, notes?: string) => {
      if (!activeBusinessId) return false;
      try {
        const { error } = await (supabase.from('hr_schedules' as any).insert({
          business_id: activeBusinessId,
          employee_id,
          shift_date,
          start_time,
          end_time,
          notes: notes || null,
        }) as any);
        if (error) throw error;
        toast({ title: 'Turno asignado' });
        await fetchAll();
        return true;
      } catch (err: any) {
        toast({ title: 'Error', description: err?.message, variant: 'destructive' });
        return false;
      }
    },
    [activeBusinessId, fetchAll, toast]
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      try {
        const { error } = await (supabase.from('hr_schedules' as any).delete().eq('id', id) as any);
        if (error) throw error;
        toast({ title: 'Turno eliminado' });
        await fetchAll();
      } catch (err: any) {
        toast({ title: 'Error', description: err?.message, variant: 'destructive' });
      }
    },
    [fetchAll, toast]
  );

  return { schedules, isLoading, fetchAll, createSchedule, deleteSchedule };
}
