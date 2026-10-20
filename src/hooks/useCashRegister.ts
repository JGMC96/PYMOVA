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
  /** null con la caja abierta si nadie conectado puede cerrarla (arqueo a ciegas, 0030). */
  total_amount: number | null;
  refunds_count: number;
  refunds_amount: number | null;
}

/**
 * Caja del negocio. `sellerSessionIds`: personas conectadas al TPV; si alguna puede cerrar
 * caja, el resumen trae importes (si no, arqueo a ciegas).
 */
export function useCashRegister(sellerSessionIds: string[] = []) {
  const { activeBusiness } = useBusiness();
  const sessionsKey = sellerSessionIds.join(',');
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
      // Parámetro nuevo de la 0030: `as never` hasta que se regenere types.ts.
      const { data: sum } = await supabase.rpc('get_register_summary', {
        _session_id: current.id,
        _seller_session_ids: sessionsKey ? sessionsKey.split(',') : [],
      } as never);
      setSummary((sum ?? []) as RegisterSummaryRow[]);
    } else {
      setSummary([]);
    }

    setIsLoading(false);
  }, [activeBusiness?.id, sessionsKey]);

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

  const closeRegister = async (
    countedAmount: number,
    notes?: string,
    opts: { sellerSessionId?: string | null; authorizationId?: string | null } = {},
  ): Promise<boolean> => {
    if (!openSession) return false;
    setIsWorking(true);
    const { error } = await supabase.rpc('close_register_session', {
      _session_id: openSession.id,
      _counted_amount: countedAmount,
      _notes: notes || null,
      _seller_session_id: opts.sellerSessionId ?? null,
      _authorization_id: opts.authorizationId ?? null,
    } as never);
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

  // Arqueo a ciegas: el servidor no da importes a quien no puede cerrar caja.
  const isBlind = !!openSession && summary.some((s) => s.total_amount === null);
  // Misma fórmula que close_register_session: fondo + ventas en efectivo − devoluciones en efectivo.
  const cashRow = summary.find((s) => s.payment_method === 'cash');
  const cashRefunds = Number(cashRow?.refunds_amount ?? 0);
  const expectedCash =
    Math.round(
      (Number(openSession?.opening_amount ?? 0) + Number(cashRow?.total_amount ?? 0) - cashRefunds) * 100,
    ) / 100;

  return {
    openSession,
    history,
    summary,
    expectedCash,
    cashRefunds,
    isBlind,
    isLoading,
    isWorking,
    openRegister,
    closeRegister,
    refresh: fetchSessions,
  };
}
