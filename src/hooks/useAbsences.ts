import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { HrAbsence, AbsenceStatus, AbsenceType } from '@/types/database';

export interface AbsenceFilters {
  status?: AbsenceStatus | 'all';
  type?: AbsenceType | 'all';
  scope?: 'mine' | 'team';
}

export interface CreateAbsenceData {
  absence_type: AbsenceType;
  custom_type_label?: string;
  start_date: string;
  end_date: string;
  reason?: string;
}

export function useAbsences(initial: AbsenceFilters = { scope: 'mine', status: 'all', type: 'all' }) {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();

  const [absences, setAbsences] = useState<(HrAbsence & { employee_user_id?: string; employee_name?: string | null })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<AbsenceFilters>(initial);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setAbsences([]);
      setIsLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      let query = (supabase
        .from('hr_absences' as any)
        .select('*, hr_employees!inner(user_id)')
        .eq('business_id', activeBusinessId)
        .order('start_date', { ascending: false }) as any);

      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.type && filters.type !== 'all') query = query.eq('absence_type', filters.type);
      if (filters.scope === 'mine' && user) {
        query = query.eq('hr_employees.user_id', user.id);
      }

      const { data, error } = await query;
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;

      const rows = (data || []) as any[];
      const userIds = Array.from(new Set(rows.map((r) => r.hr_employees?.user_id).filter(Boolean)));
      let profilesMap = new Map<string, string | null>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        profilesMap = new Map((profs || []).map((p: any) => [p.id, p.full_name]));
      }

      setAbsences(
        rows.map((r) => ({
          ...(r as HrAbsence),
          employee_user_id: r.hr_employees?.user_id,
          employee_name: profilesMap.get(r.hr_employees?.user_id) ?? null,
        }))
      );
    } catch (err) {
      console.error('useAbsences error', err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, user, filters]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createAbsence = useCallback(
    async (data: CreateAbsenceData) => {
      if (!activeBusinessId) return false;
      try {
        const { error } = await (supabase.rpc as any)('request_absence', {
          _business_id: activeBusinessId,
          _absence_type: data.absence_type,
          _start_date: data.start_date,
          _end_date: data.end_date,
          _custom_label: data.custom_type_label || null,
          _reason: data.reason || null,
        });
        if (error) throw error;
        toast({ title: 'Solicitud enviada', description: 'Pendiente de aprobación' });
        await fetchAll();
        return true;
      } catch (err: any) {
        toast({
          title: 'Error al solicitar',
          description: err?.message || 'Error inesperado',
          variant: 'destructive',
        });
        return false;
      }
    },
    [activeBusinessId, fetchAll, toast]
  );

  const reviewAbsence = useCallback(
    async (id: string, approve: boolean, notes?: string) => {
      try {
        const { error } = await (supabase.rpc as any)('review_absence', {
          _absence_id: id,
          _approve: approve,
          _notes: notes || null,
        });
        if (error) throw error;
        toast({ title: approve ? 'Solicitud aprobada' : 'Solicitud rechazada' });
        await fetchAll();
        return true;
      } catch (err: any) {
        toast({
          title: 'Error',
          description: err?.message || 'Error inesperado',
          variant: 'destructive',
        });
        return false;
      }
    },
    [fetchAll, toast]
  );

  return { absences, isLoading, filters, setFilters, fetchAll, createAbsence, reviewAbsence };
}
