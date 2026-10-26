import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { HrEmployee } from '@/types/database';

export interface EmployeeWithProfile extends HrEmployee {
  full_name: string | null;
}

export function useHrEmployees() {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<EmployeeWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setEmployees([]);
      setIsLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('hr_employees')
        .select('*')
        .eq('business_id', activeBusinessId)
        .order('created_at', { ascending: true });
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;

      const rows = (data || []) as (HrEmployee & { display_name?: string | null })[];
      // Los dependientes del TPV sin cuenta (0027) no tienen perfil: su nombre va en display_name.
      const ids = rows.map((r) => r.user_id).filter((id): id is string => !!id);
      let profMap = new Map<string, string | null>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids);
        profMap = new Map((profs || []).map((p) => [p.id, p.full_name]));
      }
      setEmployees(
        rows.map((r) => ({ ...r, full_name: (r.user_id ? profMap.get(r.user_id) : null) ?? r.display_name ?? null })),
      );
    } catch (err) {
      console.error('useHrEmployees', err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateEmployee = useCallback(
    async (id: string, patch: Partial<Pick<HrEmployee, 'hire_date' | 'weekly_hours' | 'annual_vacation_days' | 'is_active'>>) => {
      try {
        const { error } = await supabase
          .from('hr_employees')
          .update(patch)
          .eq('id', id);
        if (error) throw error;
        toast({ title: 'Empleado actualizado' });
        await fetchAll();
        return true;
      } catch (err) {
        toast({ title: 'Error', description: (err as { message?: string } | null)?.message, variant: 'destructive' });
        return false;
      }
    },
    [fetchAll, toast]
  );

  const enrollAllMembers = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const { data: members } = await supabase
        .from('business_members')
        .select('user_id')
        .eq('business_id', activeBusinessId)
        .eq('is_active', true);
      if (!members?.length) return;
      const existing = new Set(employees.map((e) => e.user_id));
      const toInsert = members
        .filter((m) => !existing.has(m.user_id))
        .map((m) => ({
          business_id: activeBusinessId,
          user_id: m.user_id,
          hire_date: new Date().toISOString().slice(0, 10),
        }));
      if (toInsert.length) {
        await supabase.from('hr_employees').insert(toInsert);
        toast({ title: `Empleados creados: ${toInsert.length}` });
        await fetchAll();
      } else {
        toast({ title: 'Todos los miembros ya están registrados' });
      }
    } catch (err) {
      toast({ title: 'Error', description: (err as { message?: string } | null)?.message, variant: 'destructive' });
    }
  }, [activeBusinessId, employees, fetchAll, toast]);

  return { employees, isLoading, fetchAll, updateEmployee, enrollAllMembers };
}
