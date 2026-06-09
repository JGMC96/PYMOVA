import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { HrPermission, AbsenceStatus, PermissionType } from '@/types/database';

export interface PermissionFilters {
  status?: AbsenceStatus | 'all';
  type?: PermissionType | 'all';
  scope?: 'mine' | 'team';
}

export interface CreatePermissionData {
  permission_type: PermissionType;
  custom_type_label?: string;
  permission_date: string;
  start_time: string;
  end_time: string;
  reason?: string;
}

export function usePermissions(initial: PermissionFilters = { scope: 'mine', status: 'all', type: 'all' }) {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();

  const [permissions, setPermissions] = useState<(HrPermission & { employee_user_id?: string; employee_name?: string | null })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<PermissionFilters>(initial);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setPermissions([]);
      setIsLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      let query = (supabase
        .from('hr_permissions' as any)
        .select('*, hr_employees!inner(user_id)')
        .eq('business_id', activeBusinessId)
        .order('permission_date', { ascending: false }) as any);

      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.type && filters.type !== 'all') query = query.eq('permission_type', filters.type);
      if (filters.scope === 'mine' && user) query = query.eq('hr_employees.user_id', user.id);

      const { data, error } = await query;
      if (reqId !== requestIdRef.current) return;
      if (error) throw error;

      const rows = (data || []) as any[];
      const userIds = Array.from(new Set(rows.map((r) => r.hr_employees?.user_id).filter(Boolean)));
      let profMap = new Map<string, string | null>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        profMap = new Map((profs || []).map((p: any) => [p.id, p.full_name]));
      }

      setPermissions(
        rows.map((r) => ({
          ...(r as HrPermission),
          employee_user_id: r.hr_employees?.user_id,
          employee_name: profMap.get(r.hr_employees?.user_id) ?? null,
        }))
      );
    } catch (err) {
      console.error('usePermissions error', err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId, user, filters]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createPermission = useCallback(
    async (data: CreatePermissionData) => {
      if (!activeBusinessId) return false;
      try {
        const { error } = await (supabase.rpc as any)('request_permission', {
          _business_id: activeBusinessId,
          _permission_type: data.permission_type,
          _permission_date: data.permission_date,
          _start_time: data.start_time,
          _end_time: data.end_time,
          _custom_label: data.custom_type_label || null,
          _reason: data.reason || null,
        });
        if (error) throw error;
        toast({ title: 'Solicitud enviada', description: 'Pendiente de aprobación' });
        await fetchAll();
        return true;
      } catch (err: any) {
        toast({ title: 'Error', description: err?.message || 'Error inesperado', variant: 'destructive' });
        return false;
      }
    },
    [activeBusinessId, fetchAll, toast]
  );

  const reviewPermission = useCallback(
    async (id: string, approve: boolean, notes?: string) => {
      try {
        const { error } = await (supabase.rpc as any)('review_permission', {
          _permission_id: id,
          _approve: approve,
          _notes: notes || null,
        });
        if (error) throw error;
        toast({ title: approve ? 'Permiso aprobado' : 'Permiso rechazado' });
        await fetchAll();
        return true;
      } catch (err: any) {
        toast({ title: 'Error', description: err?.message || 'Error inesperado', variant: 'destructive' });
        return false;
      }
    },
    [fetchAll, toast]
  );

  return { permissions, isLoading, filters, setFilters, fetchAll, createPermission, reviewPermission };
}
