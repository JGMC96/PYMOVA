import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

export interface ShopifyConnection {
  id: string;
  shop_domain: string;
  orders_sync_enabled: boolean;
  webhooks_registered_at: string | null;
  last_orders_sync_at: string | null;
  /** 0045: cuándo se importó el historial completo de pedidos. */
  orders_history_imported_at?: string | null;
}

/** Importación del historial completo (por tandas). */
export interface HistoryImportState {
  running: boolean;
  processed: number;
  total: number | null;
  created: number;
  updated: number;
  failed: number;
  customersCreated: number;
}

interface HistoryChunk {
  total: number | null;
  created: number;
  updated: number;
  failed: number;
  customers_created: number;
  cursor: string | null;
  done: boolean;
}

interface OrdersSyncSummary {
  created: number;
  updated: number;
  failed: number;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('shopify-orders', { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

export function useShopifyOrdersSync() {
  const { activeBusinessId } = useBusiness();
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [lastSummary, setLastSummary] = useState<OrdersSyncSummary | null>(null);
  const requestIdRef = useRef(0);
  const [history, setHistory] = useState<HistoryImportState | null>(null);
  const cancelHistory = useRef(false);

  const refresh = useCallback(async () => {
    if (!activeBusinessId) {
      setConnection(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const result = await invoke<{ connection: ShopifyConnection | null }>({
        action: 'status',
        business_id: activeBusinessId,
      });
      if (requestId !== requestIdRef.current) return;
      setConnection(result.connection ?? null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Error cargando la conexión de Shopify:', err);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const syncOrders = useCallback(
    async (days = 30) => {
      if (!activeBusinessId) return null;
      setIsSyncing(true);
      try {
        const result = await invoke<OrdersSyncSummary>({
          action: 'sync',
          business_id: activeBusinessId,
          days,
        });
        setLastSummary(result);
        toast.success(
          `Pedidos sincronizados: ${result.created} nuevos, ${result.updated} actualizados${
            result.failed ? `, ${result.failed} con error` : ''
          }`,
        );
        await refresh();
        return result;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudieron sincronizar los pedidos');
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [activeBusinessId, refresh],
  );

  // Historial completo de pedidos web, tanda a tanda (unos 200 pedidos por llamada).
  const importHistory = useCallback(async () => {
    if (!activeBusinessId) return;
    cancelHistory.current = false;
    let state: HistoryImportState = {
      running: true, processed: 0, total: null, created: 0, updated: 0, failed: 0, customersCreated: 0,
    };
    setHistory(state);
    let cursor: string | null = null;
    try {
      for (;;) {
        const chunk: HistoryChunk = await invoke<HistoryChunk>({
          action: 'import-history',
          business_id: activeBusinessId,
          cursor,
          pages: 4,
        });
        state = {
          ...state,
          total: chunk.total ?? state.total,
          created: state.created + chunk.created,
          updated: state.updated + chunk.updated,
          failed: state.failed + chunk.failed,
          customersCreated: state.customersCreated + chunk.customers_created,
          processed: state.processed + chunk.created + chunk.updated + chunk.failed,
        };
        setHistory(state);
        if (chunk.done || !chunk.cursor) break;
        if (cancelHistory.current) {
          toast.info('Importación detenida. Puedes volver a lanzarla cuando quieras: no duplica pedidos.');
          break;
        }
        cursor = chunk.cursor;
      }
      if (!cancelHistory.current) {
        toast.success(
          `Historial importado: ${state.created} pedidos nuevos y ${state.updated} actualizados${
            state.failed ? `, ${state.failed} con error` : ''
          }`,
        );
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo importar el historial', {
        description: 'Lo importado se queda. Vuelve a lanzarla para seguir: no duplica pedidos.',
      });
    } finally {
      setHistory((h) => (h ? { ...h, running: false } : h));
    }
  }, [activeBusinessId, refresh]);

  const stopHistory = useCallback(() => {
    cancelHistory.current = true;
  }, []);

  const diagnose = useCallback(async () => {
    if (!activeBusinessId) return null;
    try {
      const result = await invoke<{ scopes: string[]; missing: string[] }>({
        action: 'diagnose',
        business_id: activeBusinessId,
      });
      if (result.missing.length > 0) {
        toast.error(`Faltan permisos en Shopify: ${result.missing.join(', ')}`, {
          description: 'Conecta tu cuenta de Shopify o regenera el token con permisos de pedidos.',
        });
      } else {
        toast.success('Permisos de pedidos correctos en Shopify');
      }
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo comprobar los permisos');
      return null;
    }
  }, [activeBusinessId]);

  const registerWebhooks = useCallback(async () => {
    if (!activeBusinessId) return false;
    setIsRegistering(true);
    try {
      await invoke({ action: 'register-webhooks', business_id: activeBusinessId });
      toast.success('Avisos automáticos de Shopify activados');
      await refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron activar los webhooks');
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [activeBusinessId, refresh]);

  return {
    connection,
    isLoading,
    isSyncing,
    isRegistering,
    lastSummary,
    refresh,
    syncOrders,
    history,
    importHistory,
    stopHistory,
    diagnose,
    registerWebhooks,
  };
}

export async function pushShopifyOrderStatus(params: {
  businessId: string;
  orderId: string;
  status: string;
  trackingNumber?: string | null;
  refund?: boolean;
}) {
  return invoke({
    action: 'push-status',
    business_id: params.businessId,
    order_id: params.orderId,
    status: params.status,
    tracking_number: params.trackingNumber ?? null,
    refund: params.refund ?? false,
  });
}

export async function pushShopifyRefund(params: { businessId: string; returnId: string }) {
  return invoke<{ ok: boolean; refund_id?: string | null; skipped?: string }>({
    action: 'push-refund',
    business_id: params.businessId,
    return_id: params.returnId,
  });
}

