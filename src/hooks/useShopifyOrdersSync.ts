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

