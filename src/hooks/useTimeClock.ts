import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { HrDashboard, HrTimeEntry, TimeEntryType } from '@/types/database';

export type ClockState = 'out' | 'working' | 'on_break';

function deriveState(entry: TimeEntryType | null | undefined): ClockState {
  if (!entry || entry === 'clock_out') return 'out';
  if (entry === 'break_start') return 'on_break';
  return 'working';
}

async function getCoords(): Promise<{ lat?: number; lng?: number; denied: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { denied: true };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ denied: true }), 5000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, denied: false });
      },
      () => {
        clearTimeout(timer);
        resolve({ denied: true });
      },
      { enableHighAccuracy: true, timeout: 4500, maximumAge: 60000 }
    );
  });
}

export function useTimeClock() {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();

  const [dashboard, setDashboard] = useState<HrDashboard | null>(null);
  const [todayEntries, setTodayEntries] = useState<HrTimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setDashboard(null);
      setTodayEntries([]);
      setIsLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const { data: dashData, error: dashErr } = await supabase.rpc('get_hr_dashboard', {
        _business_id: activeBusinessId,
      });
      if (reqId !== requestIdRef.current) return;
      if (dashErr) throw dashErr;
      const row = Array.isArray(dashData) ? dashData[0] : dashData;
      // my_pending_reviews llega con la 0020; types.ts se regenera después.
      setDashboard((row ?? null) as unknown as HrDashboard | null);

      const empId = row?.my_employee_id;
      if (empId) {
        // Fichajes de la sesión abierta (aunque empezara ayer) o, si no hay, los de hoy.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const openSince = row?.my_session_clock_in ? new Date(row.my_session_clock_in) : null;
        const since = openSince && openSince < today ? openSince : today;
        const { data: entries } = await supabase
          .from('hr_time_entries')
          .select('*')
          .eq('business_id', activeBusinessId)
          .eq('employee_id', empId)
          .gte('occurred_at', since.toISOString())
          .order('occurred_at', { ascending: false });
        if (reqId !== requestIdRef.current) return;
        setTodayEntries((entries || []) as unknown as HrTimeEntry[]);
      } else {
        setTodayEntries([]);
      }
    } catch (err) {
      console.error('useTimeClock fetch error', err);
    } finally {
      if (reqId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const performAction = useCallback(
    async (entry_type: TimeEntryType) => {
      if (!activeBusinessId) return;
      setActing(true);
      try {
        const coords = await getCoords();
        if (coords.denied) {
          toast({
            title: 'Sin geolocalización',
            description: 'El fichaje se registrará sin coordenadas.',
          });
        }
        // Sin coordenadas se omiten y la RPC usa NULL por defecto.
        const { error } = await supabase.rpc('clock_action', {
          _business_id: activeBusinessId,
          _entry_type: entry_type,
          _latitude: coords.lat,
          _longitude: coords.lng,
        });
        if (error) throw error;
        toast({ title: 'Fichaje registrado' });
        await fetchAll();
      } catch (err) {
        toast({
          title: 'Error',
          description: (err as { message?: string } | null)?.message || 'No se pudo registrar el fichaje',
          variant: 'destructive',
        });
      } finally {
        setActing(false);
      }
    },
    [activeBusinessId, fetchAll, toast]
  );

  const state: ClockState = deriveState(dashboard?.my_last_entry_type ?? null);

  return {
    dashboard,
    todayEntries,
    isLoading,
    acting,
    state,
    refresh: fetchAll,
    clockIn: () => performAction('clock_in'),
    breakStart: () => performAction('break_start'),
    breakEnd: () => performAction('break_end'),
    clockOut: () => performAction('clock_out'),
  };
}
