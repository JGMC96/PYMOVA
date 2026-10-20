// Personas conectadas al TPV: compartido por Nueva Venta, Historial y Vendedores.
// Cada persona mete su PIN (start_seller_session) y queda conectada SELLER_SESSION_HOURS
// en ese TPV; la lista se guarda en localStorage por negocio. Al cobrar o devolver,
// chooseSeller() decide quién: nadie → PIN, una persona → esa, varias → se pregunta.
// El diálogo lo pinta SellerDialog, que lee `dialog` y llama a resolveDialog().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import {
  activeSellers,
  authorizers,
  hasPermission,
  parseStoredSellers,
  requiresSeller as computeRequiresSeller,
  SELLER_SESSION_MS,
  sellerChoice,
  sellerStorageKey,
  withSeller,
  type PosAction,
  type PosEmployee,
  type PosPermission,
  type StoredSeller,
} from '@/lib/sellerSession';

export interface PinResult {
  ok: boolean;
  error: string | null;
  lockedSeconds: number;
}

/** Resultado de elegir quién vende: `cancelled` si se cerró el diálogo sin elegir. */
export interface SellerPick {
  seller: StoredSeller | null;
  cancelled: boolean;
}

/**
 * Diálogo abierto:
 * - 'ask': ¿quién ha hecho la venta? (varios conectados);
 * - 'login': nombre y PIN (nadie conectado, o «Otra persona», o «Añadir persona»);
 * - 'change-pin': cambiar el PIN con el actual.
 */
export type SellerDialogMode = 'ask' | 'login' | 'change-pin' | 'authorize';

export interface SellerDialogState {
  mode: SellerDialogMode;
  purpose: string;
  /** Solo en 'authorize': qué se autoriza y, si es un descuento, el %. */
  action?: PosAction;
  amount?: number;
}

interface SellerSessionValue {
  employees: PosEmployee[];
  isLoadingEmployees: boolean;
  /** Conectados que no han caducado. */
  sellers: StoredSeller[];
  /** Hay dependientes con PIN: no se vende ni se devuelve sin identificarse. */
  requiresSeller: boolean;
  dialog: SellerDialogState | null;
  permissions: PosPermission[];
  /** Permisos de una persona (null si no se conocen). */
  permissionsOf: (employeeId: string) => PosPermission | null;
  /** ¿Puede hacerlo esa persona sin autorización? Sin dependientes con PIN, siempre. */
  can: (seller: StoredSeller | null, action: PosAction, amount?: number) => boolean;
  /** Pide el PIN de alguien con permiso; devuelve el id de la autorización o null si se cancela. */
  authorize: (action: PosAction, purpose: string, amount?: number) => Promise<string | null>;
  /** Quién puede autorizar una acción. */
  authorizersFor: (action: PosAction, amount?: number) => PosEmployee[];
  authorizeWithPin: (employeeId: string, pin: string) => Promise<PinResult>;
  /** Cobrar, devolver o fichar: decide quién (puede abrir el diálogo). */
  chooseSeller: (purpose?: string) => Promise<SellerPick>;
  /** Respuesta del diálogo: la persona elegida o conectada, o null si se cancela. */
  resolveDialog: (seller: StoredSeller | null) => void;
  setDialogMode: (mode: SellerDialogMode) => void;
  openLogin: () => void;
  openChangePin: () => void;
  login: (employeeId: string, pin: string) => Promise<PinResult & { seller: StoredSeller | null }>;
  changePin: (employeeId: string, oldPin: string, newPin: string) => Promise<PinResult>;
  disconnect: (employeeId: string) => Promise<void>;
  disconnectAll: () => Promise<void>;
  /** El servidor ha rechazado la sesión (caducada o cerrada): se quita de la lista. */
  dropSession: (sessionId: string) => void;
  refreshEmployees: () => Promise<void>;
  /** Fichar desde el TPV con la persona elegida; sin dependientes con PIN, la cuenta. */
  clock: (entryType: 'clock_in' | 'clock_out') => Promise<{ error: string | null; name: string | null } | null>;
}

const SellerSessionContext = createContext<SellerSessionValue | null>(null);

// RPC nuevas de la 0027/0028: `as never` hasta que se regenere types.ts.
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never);

const firstRow = <T,>(data: unknown): T | null => {
  const rows = (data ?? null) as unknown;
  return ((Array.isArray(rows) ? rows[0] : rows) as T | null) ?? null;
};

export function SellerSessionProvider({ children }: { children: ReactNode }) {
  const { activeBusinessId } = useBusiness();
  const [employees, setEmployees] = useState<PosEmployee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [stored, setStored] = useState<StoredSeller[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dialog, setDialog] = useState<SellerDialogState | null>(null);
  const [permissions, setPermissions] = useState<PosPermission[]>([]);
  const pending = useRef<((pick: SellerPick) => void) | null>(null);
  const pendingAuth = useRef<((id: string | null) => void) | null>(null);

  const storageKey = activeBusinessId ? sellerStorageKey(activeBusinessId) : null;

  const refreshEmployees = useCallback(async () => {
    if (!activeBusinessId) {
      setEmployees([]);
      setIsLoadingEmployees(false);
      return;
    }
    setIsLoadingEmployees(true);
    const [emps, perms] = await Promise.all([
      rpc('get_pos_employees', { _business_id: activeBusinessId }),
      rpc('get_pos_permissions', { _business_id: activeBusinessId }),
    ]);
    if (emps.error) console.error('get_pos_employees', emps.error);
    if (perms.error) console.error('get_pos_permissions', perms.error);
    setEmployees((emps.data ?? []) as PosEmployee[]);
    setPermissions(
      ((perms.data ?? []) as PosPermission[]).map((p) => ({ ...p, max_discount_pct: Number(p.max_discount_pct) })),
    );
    setIsLoadingEmployees(false);
  }, [activeBusinessId]);

  useEffect(() => {
    void refreshEmployees();
  }, [refreshEmployees]);

  // Lista guardada (recarga o pestaña nueva dentro de las 3 horas).
  useEffect(() => {
    if (!storageKey) {
      setStored([]);
      return;
    }
    try {
      setStored(parseStoredSellers(localStorage.getItem(storageKey)));
    } catch {
      setStored([]);
    }
  }, [storageKey]);

  // Reloj de minuto en minuto para que las caducadas desaparezcan solas.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const persist = useCallback(
    (update: (list: StoredSeller[]) => StoredSeller[]) => {
      setStored((prev) => {
        const next = activeSellers(update(prev), Date.now());
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // Sin almacenamiento (modo privado): la lista vive solo en memoria.
          }
        }
        return next;
      });
      setNow(Date.now());
    },
    [storageKey],
  );

  const sellers = useMemo(() => activeSellers(stored, now), [stored, now]);
  const requiresSeller = computeRequiresSeller(employees);

  const permissionsOf = useCallback(
    (employeeId: string) => permissions.find((p) => p.employee_id === employeeId) ?? null,
    [permissions],
  );

  const can = useCallback(
    (seller: StoredSeller | null, action: PosAction, amount = 0) =>
      !requiresSeller || !seller || hasPermission(permissionsOf(seller.employeeId), action, amount),
    [requiresSeller, permissionsOf],
  );

  const authorize = useCallback((action: PosAction, purpose: string, amount?: number): Promise<string | null> => {
    pendingAuth.current?.(null);
    return new Promise<string | null>((resolve) => {
      pendingAuth.current = resolve;
      setDialog({ mode: 'authorize', purpose, action, amount });
    });
  }, []);

  const authorizersFor = useCallback(
    (action: PosAction, amount = 0) => authorizers(permissions, employees, action, amount),
    [permissions, employees],
  );

  const finishAuthorization = useCallback((id: string | null) => {
    setDialog(null);
    const resolve = pendingAuth.current;
    pendingAuth.current = null;
    resolve?.(id);
  }, []);

  const authorizeWithPin = useCallback(
    async (employeeId: string, pin: string): Promise<PinResult> => {
      if (!activeBusinessId || dialog?.mode !== 'authorize' || !dialog.action) {
        return { ok: false, error: 'No hay nada que autorizar', lockedSeconds: 0 };
      }
      const { data, error } = await rpc('authorize_action', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _pin: pin,
        _action: dialog.action,
        // El tope autorizado se redondea hacia arriba para cubrir el % que calcula el servidor.
        _amount: dialog.action === 'discount' ? Math.ceil((dialog.amount ?? 0) * 100) / 100 : null,
      });
      if (error) return { ok: false, error: error.message, lockedSeconds: 0 };
      const row = firstRow<{ ok: boolean; error: string | null; locked_seconds: number; authorization_id: string }>(data);
      if (!row?.ok) return { ok: false, error: row?.error ?? 'PIN incorrecto', lockedSeconds: row?.locked_seconds ?? 0 };
      finishAuthorization(row.authorization_id);
      return { ok: true, error: null, lockedSeconds: 0 };
    },
    [activeBusinessId, dialog, finishAuthorization],
  );

  const resolveDialog = useCallback((seller: StoredSeller | null) => {
    // Cerrar el diálogo de autorización la cancela.
    if (pendingAuth.current) {
      finishAuthorization(null);
      return;
    }
    setDialog(null);
    const resolve = pending.current;
    pending.current = null;
    resolve?.({ seller, cancelled: seller === null });
  }, [finishAuthorization]);

  const chooseSeller = useCallback(
    (purpose = 'la venta'): Promise<SellerPick> => {
      if (!requiresSeller) return Promise.resolve({ seller: null, cancelled: false });
      const active = activeSellers(stored, Date.now());
      const choice = sellerChoice(active);
      if (choice === 'auto') return Promise.resolve({ seller: active[0], cancelled: false });
      // Si había otro diálogo esperando, se da por cancelado.
      pending.current?.({ seller: null, cancelled: true });
      return new Promise<SellerPick>((resolve) => {
        pending.current = resolve;
        setDialog({ mode: choice === 'ask' ? 'ask' : 'login', purpose });
      });
    },
    [requiresSeller, stored],
  );

  const login = useCallback(
    async (employeeId: string, pin: string) => {
      if (!activeBusinessId) return { ok: false, error: 'No hay negocio activo', lockedSeconds: 0, seller: null };
      // Si esa persona ya estaba conectada, su sesión anterior se cierra.
      const previous = stored.find((s) => s.employeeId === employeeId);
      if (previous) await rpc('end_seller_session', { _session_id: previous.sessionId });
      const { data, error } = await rpc('start_seller_session', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _pin: pin,
      });
      if (error) return { ok: false, error: error.message, lockedSeconds: 0, seller: null };
      const row = firstRow<{ ok: boolean; error: string | null; locked_seconds: number; session_id: string; employee_id: string; name: string }>(data);
      if (!row?.ok) {
        return { ok: false, error: row?.error ?? 'PIN incorrecto', lockedSeconds: row?.locked_seconds ?? 0, seller: null };
      }
      const started = Date.now();
      const seller: StoredSeller = {
        sessionId: row.session_id,
        employeeId: row.employee_id,
        name: row.name,
        startedAt: started,
        expiresAt: started + SELLER_SESSION_MS,
      };
      persist((list) => withSeller(list, seller));
      return { ok: true, error: null, lockedSeconds: 0, seller };
    },
    [activeBusinessId, stored, persist],
  );

  const changePin = useCallback(
    async (employeeId: string, oldPin: string, newPin: string): Promise<PinResult> => {
      if (!activeBusinessId) return { ok: false, error: 'No hay negocio activo', lockedSeconds: 0 };
      const { data, error } = await rpc('change_own_pin', {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _old_pin: oldPin,
        _new_pin: newPin,
      });
      if (error) return { ok: false, error: error.message, lockedSeconds: 0 };
      const row = firstRow<{ ok: boolean; error: string | null; locked_seconds: number }>(data);
      if (!row?.ok) return { ok: false, error: row?.error ?? 'PIN incorrecto', lockedSeconds: row?.locked_seconds ?? 0 };
      // El servidor cierra sus sesiones: tiene que volver a identificarse con el PIN nuevo.
      persist((list) => list.filter((s) => s.employeeId !== employeeId));
      return { ok: true, error: null, lockedSeconds: 0 };
    },
    [activeBusinessId, persist],
  );

  const disconnect = useCallback(
    async (employeeId: string) => {
      const current = stored.find((s) => s.employeeId === employeeId);
      persist((list) => list.filter((s) => s.employeeId !== employeeId));
      if (current) await rpc('end_seller_session', { _session_id: current.sessionId });
    },
    [stored, persist],
  );

  const disconnectAll = useCallback(async () => {
    const current = stored;
    persist(() => []);
    await Promise.all(current.map((s) => rpc('end_seller_session', { _session_id: s.sessionId })));
  }, [stored, persist]);

  const dropSession = useCallback(
    (sessionId: string) => persist((list) => list.filter((s) => s.sessionId !== sessionId)),
    [persist],
  );

  const clock = useCallback(
    async (entryType: 'clock_in' | 'clock_out') => {
      if (!activeBusinessId) return { error: 'No hay negocio activo', name: null };
      const pick = await chooseSeller(entryType === 'clock_in' ? 'la entrada' : 'la salida');
      if (pick.cancelled) return null;
      const { error } = await rpc('clock_action', {
        _business_id: activeBusinessId,
        _entry_type: entryType,
        _seller_session_id: pick.seller?.sessionId ?? null,
      });
      return { error: error ? error.message : null, name: pick.seller?.name ?? null };
    },
    [activeBusinessId, chooseSeller],
  );

  const value = useMemo<SellerSessionValue>(
    () => ({
      employees,
      isLoadingEmployees,
      sellers,
      requiresSeller,
      dialog,
      permissions,
      permissionsOf,
      can,
      authorize,
      authorizersFor,
      authorizeWithPin,
      chooseSeller,
      resolveDialog,
      setDialogMode: (mode) => setDialog((d) => (d ? { ...d, mode } : { mode, purpose: '' })),
      openLogin: () => setDialog({ mode: 'login', purpose: '' }),
      openChangePin: () => setDialog({ mode: 'change-pin', purpose: '' }),
      login,
      changePin,
      disconnect,
      disconnectAll,
      dropSession,
      refreshEmployees,
      clock,
    }),
    [employees, isLoadingEmployees, sellers, requiresSeller, dialog, permissions, permissionsOf, can, authorize, authorizersFor, authorizeWithPin, chooseSeller, resolveDialog, login, changePin, disconnect, disconnectAll, dropSession, refreshEmployees, clock],
  );

  return <SellerSessionContext.Provider value={value}>{children}</SellerSessionContext.Provider>;
}

export function useSellerSession(): SellerSessionValue {
  const ctx = useContext(SellerSessionContext);
  if (!ctx) throw new Error('useSellerSession debe usarse dentro de SellerSessionProvider');
  return ctx;
}
