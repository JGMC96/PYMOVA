// Vendedor activo del TPV: compartido por Nueva Venta, Historial y Vendedores.
// La sesión la crea el servidor con el PIN (start_seller_session) y se guarda en
// sessionStorage para sobrevivir a una recarga; se cierra al bloquear, al cambiar
// de dependiente o tras IDLE_LOCK_MINUTES sin tocar la pantalla.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import {
  IDLE_LOCK_MS,
  isIdleLocked,
  parseStoredSeller,
  requiresSeller as computeRequiresSeller,
  sellerStorageKey,
  type PosEmployee,
  type StoredSeller,
} from '@/lib/sellerSession';

export interface StartResult {
  ok: boolean;
  error: string | null;
  lockedSeconds: number;
}

interface SellerSessionValue {
  employees: PosEmployee[];
  isLoadingEmployees: boolean;
  seller: StoredSeller | null;
  /** Hay dependientes con PIN: el TPV exige identificarse para cobrar. */
  requiresSeller: boolean;
  /** Abre el diálogo del PIN (lo pinta POSPanel). */
  pinDialogOpen: boolean;
  setPinDialogOpen: (open: boolean) => void;
  start: (employeeId: string, pin: string) => Promise<StartResult>;
  end: () => Promise<void>;
  refreshEmployees: () => Promise<void>;
  /** Fichar desde el TPV: con sesión, el dependiente; sin ella, la cuenta. */
  clock: (entryType: 'clock_in' | 'clock_out') => Promise<string | null>;
}

const SellerSessionContext = createContext<SellerSessionValue | null>(null);

// RPC nuevas de la 0027: `as never` hasta que se regenere types.ts.
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never);

export function SellerSessionProvider({ children }: { children: ReactNode }) {
  const { activeBusinessId } = useBusiness();
  const [employees, setEmployees] = useState<PosEmployee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [seller, setSeller] = useState<StoredSeller | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const lastActivity = useRef(Date.now());

  const storageKey = activeBusinessId ? sellerStorageKey(activeBusinessId) : null;

  const refreshEmployees = useCallback(async () => {
    if (!activeBusinessId) {
      setEmployees([]);
      setIsLoadingEmployees(false);
      return;
    }
    setIsLoadingEmployees(true);
    const { data, error } = await rpc('get_pos_employees', { _business_id: activeBusinessId });
    if (error) console.error('get_pos_employees', error);
    setEmployees((data ?? []) as PosEmployee[]);
    setIsLoadingEmployees(false);
  }, [activeBusinessId]);

  useEffect(() => {
    void refreshEmployees();
  }, [refreshEmployees]);

  // Sesión guardada (recarga de la página).
  useEffect(() => {
    if (!storageKey) {
      setSeller(null);
      return;
    }
    try {
      setSeller(parseStoredSeller(sessionStorage.getItem(storageKey)));
    } catch {
      setSeller(null);
    }
  }, [storageKey]);

  const persist = useCallback(
    (value: StoredSeller | null) => {
      setSeller(value);
      if (!storageKey) return;
      try {
        if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
        else sessionStorage.removeItem(storageKey);
      } catch {
        // Sin almacenamiento (modo privado): la sesión vive solo en memoria.
      }
    },
    [storageKey],
  );

  const end = useCallback(async () => {
    const current = seller;
    persist(null);
    if (current) await rpc('end_seller_session', { _session_id: current.sessionId });
  }, [seller, persist]);

  const start = useCallback(
    async (employeeId: string, pin: string): Promise<StartResult> => {
      if (!activeBusinessId) return { ok: false, error: 'No hay negocio activo', lockedSeconds: 0 };
      if (seller) await rpc('end_seller_session', { _session_id: seller.sessionId });
      const { data, error } = await rpc('start_seller_session', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _pin: pin,
      });
      if (error) return { ok: false, error: error.message, lockedSeconds: 0 };
      const rows = (data ?? null) as unknown;
      const row = (Array.isArray(rows) ? rows[0] : rows) as
        | { ok: boolean; error: string | null; locked_seconds: number; session_id: string; employee_id: string; name: string }
        | null;
      if (!row?.ok) {
        return { ok: false, error: row?.error ?? 'PIN incorrecto', lockedSeconds: row?.locked_seconds ?? 0 };
      }
      lastActivity.current = Date.now();
      persist({ sessionId: row.session_id, employeeId: row.employee_id, name: row.name, startedAt: Date.now() });
      setPinDialogOpen(false);
      return { ok: true, error: null, lockedSeconds: 0 };
    },
    [activeBusinessId, seller, persist],
  );

  // Bloqueo por inactividad: cualquier toque o tecla cuenta como actividad.
  useEffect(() => {
    if (!seller) return;
    const touch = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const timer = window.setInterval(() => {
      if (isIdleLocked(lastActivity.current, Date.now(), IDLE_LOCK_MS)) void end();
    }, 15_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.clearInterval(timer);
    };
  }, [seller, end]);

  const clock = useCallback(
    async (entryType: 'clock_in' | 'clock_out'): Promise<string | null> => {
      if (!activeBusinessId) return 'No hay negocio activo';
      const { error } = await rpc('clock_action', {
        _business_id: activeBusinessId,
        _entry_type: entryType,
        _seller_session_id: seller?.sessionId ?? null,
      });
      return error ? error.message : null;
    },
    [activeBusinessId, seller?.sessionId],
  );

  const value = useMemo<SellerSessionValue>(
    () => ({
      employees,
      isLoadingEmployees,
      seller,
      requiresSeller: computeRequiresSeller(employees),
      pinDialogOpen,
      setPinDialogOpen,
      start,
      end,
      refreshEmployees,
      clock,
    }),
    [employees, isLoadingEmployees, seller, pinDialogOpen, start, end, refreshEmployees, clock],
  );

  return <SellerSessionContext.Provider value={value}>{children}</SellerSessionContext.Provider>;
}

export function useSellerSession(): SellerSessionValue {
  const ctx = useContext(SellerSessionContext);
  if (!ctx) throw new Error('useSellerSession debe usarse dentro de SellerSessionProvider');
  return ctx;
}
