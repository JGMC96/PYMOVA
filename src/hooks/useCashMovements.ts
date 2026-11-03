import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { CashMovement, CashMovementType } from '@/lib/cashMovements';

/** Movimientos de una caja (0059). `as never`: RPC nuevas hasta que se regenere types.ts. */
export async function fetchCashMovements(sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await supabase.rpc('get_cash_movements' as never, { _session_id: sessionId } as never);
  if (error) throw error;
  return ((data ?? []) as CashMovement[]).map((m) => ({ ...m, amount: Number(m.amount) }));
}

export interface NewCashMovement {
  type: CashMovementType;
  amount: number;
  category: string | null;
  reason: string;
  authorizationId: string | null;
}

/** Movimientos de la caja abierta. El PIN lo pide quien llama, como en el cierre de caja. */
export function useCashMovements(sessionId: string | null | undefined) {
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setMovements([]);
      return;
    }
    try {
      setMovements(await fetchCashMovements(sessionId));
    } catch (error) {
      console.error('Error fetching cash movements:', error);
      toast.error('Error al cargar los movimientos de caja');
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createMovement = async (m: NewCashMovement): Promise<boolean> => {
    if (!sessionId) return false;
    setIsSaving(true);
    const { error } = await supabase.rpc('create_cash_movement' as never, {
      _session_id: sessionId,
      _type: m.type,
      _amount: m.amount,
      _category: m.category,
      _reason: m.reason,
      _authorization_id: m.authorizationId,
    } as never);
    setIsSaving(false);
    if (error) {
      console.error('Error creating cash movement:', error);
      toast.error(error.message || 'No se pudo apuntar el movimiento');
      return false;
    }
    toast.success('Movimiento apuntado');
    await refresh();
    return true;
  };

  const voidMovement = async (id: string, reason: string, authorizationId: string | null): Promise<boolean> => {
    setIsSaving(true);
    const { error } = await supabase.rpc('void_cash_movement' as never, {
      _movement_id: id,
      _reason: reason,
      _authorization_id: authorizationId,
    } as never);
    setIsSaving(false);
    if (error) {
      console.error('Error voiding cash movement:', error);
      toast.error(error.message || 'No se pudo anular el movimiento');
      return false;
    }
    toast.success('Movimiento anulado');
    await refresh();
    return true;
  };

  return { movements, isSaving, refresh, createMovement, voidMovement };
}
