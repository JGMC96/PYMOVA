import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

export interface RegisterSession {
  id: string;
  business_id: string;
  status: 'open' | 'closed';
  opened_by: string | null;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  notes: string | null;
}

export interface RegisterSummaryRow {
  payment_method: string;
  sales_count: number;
  total_amount: number;
}

export function useCashRegister() {
  const { activeBusiness } = useBusiness();
  const [openSession, setOpenSession] = useState<RegisterSession | null>(null);
  const [history, setHistory] = useState<RegisterSession[]>([]);
  const [summary, setSummary] = useState<RegisterSummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!activeBusiness?.id) return;
    setIsLoading(true);

    const { data, error } = await supabase
      .from('cash_register_sessions')
      .select('*')
      .eq('business_id', activeBusiness.id)
      .order('opened_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Error fetching register sessions:', error);
      toast.error('Error al cargar las cajas');
      setIsLoading(false);
      return;
    }

    const sessions = (data ?? []) as RegisterSession[];
    const current = sessions.find((s) => s.status === 'open') ?? null;
    setOpenSession(current);
    setHistory(sessions.filter((s) => s.status === 'closed'));

    if (current) {
      const { data: sum } = await supabase.rpc('get_register_summary', {
        _session_id: current.id,
      });
      setSummary((sum ?? []) as RegisterSummaryRow[]);
    } else {
      setSummary([]);
    }

    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const openRegister = async (openingAmount: number): Promise<boolean> => {
    if (!activeBusiness?.id) return false;
    setIsWorking(true);
    const { error } = await supabase.rpc('open_register_session', {
      _business_id: activeBusiness.id,
      _opening_amount: openingAmount,
    });
    setIsWorking(false);

    if (error) {
      console.error('Error opening register:', error);
      toast.error(error.message || 'No se pudo abrir la caja');
      return false;
    }
    toast.success('Caja abierta');
    fetchSessions();
    return true;
  };

  const closeRegister = async (countedAmount: number, notes?: string): Promise<boolean> => {
    if (!openSession) return false;
    setIsWorking(true);
    const { error } = await supabase.rpc('close_register_session', {
      _session_id: openSession.id,
      _counted_amount: countedAmount,
      _notes: notes || null,
    });
    setIsWorking(false);

    if (error) {
      console.error('Error closing register:', error);
      toast.error(error.message || 'No se pudo cerrar la caja');
      return false;
    }
    toast.success('Caja cerrada y arqueo guardado');
    fetchSessions();
    return true;
  };

  const expectedCash =
    (openSession?.opening_amount ?? 0) +
    (summary.find((s) => s.payment_method === 'cash')?.total_amount ?? 0);

  return {
    openSession,
    history,
    summary,
    expectedCash,
    isLoading,
    isWorking,
    openRegister,
    closeRegister,
    refresh: fetchSessions,
  };
}
