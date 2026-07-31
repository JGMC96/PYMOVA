import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/contexts/BusinessContext';
import { invokeShopifySync } from '@/lib/shopify';

export interface ShopifyConnectionStatus {
  shop_domain: string;
  api_version: string;
  required_scopes: string[];
  /** La tienda está vinculada a este negocio. */
  claimed: boolean;
  /** La tienda pertenece a otro negocio: esta cuenta no puede usarla. */
  owned_by_other_business: boolean;
  pending_webhooks: number;
  connection: {
    granted_scopes: string[] | null;
    last_verified_at: string | null;
    last_catalog_sync_at: string | null;
    last_orders_sync_at: string | null;
    last_sync_status: string | null;
    last_sync_error: string | null;
    uninstalled_at: string | null;
  } | null;
  stats: {
    products: number;
    variants: number;
    orders: number;
    clients: number;
    open_issues: number;
    inventory_levels: number;
    fulfillments: number;
  };
}


/** Estado de la conexión con Shopify (solo lectura) y acciones de verificación/sincronización. */
export function useShopifyConnection() {
  const { activeBusinessId } = useBusiness();
  const [status, setStatus] = useState<ShopifyConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsLoading(true);
    try {
      const data = await invokeShopifySync<ShopifyConnectionStatus>({
        action: 'status',
        business_id: activeBusinessId,
      });
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const verify = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsVerifying(true);
    try {
      const result = await invokeShopifySync<{ shop_name: string; missing: string[] }>({
        action: 'verify',
        business_id: activeBusinessId,
      });
      if (result.missing?.length) {
        toast.warning('Conexión establecida con permisos incompletos', {
          description: `Faltan alcances: ${result.missing.join(', ')}`,
        });
      } else {
        toast.success(`Conexión correcta con ${result.shop_name}`);
      }
      await refresh();
    } catch (err) {
      toast.error('No se pudo verificar la conexión', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsVerifying(false);
    }
  }, [activeBusinessId, refresh]);

  const sync = useCallback(
    async (scope: 'all' | 'catalog' | 'orders' | 'customers' = 'all') => {
      if (!activeBusinessId) return;
      setIsSyncing(true);
      try {
        const result = await invokeShopifySync<{ message: string; failed: number }>({
          action: 'sync',
          business_id: activeBusinessId,
          scope,
        });
        if (result.failed > 0) {
          toast.warning('Sincronización completada con incidencias', {
            description: result.message,
          });
        } else {
          toast.success('Sincronización completada', { description: result.message });
        }
        await refresh();
      } catch (err) {
        toast.error('Error al sincronizar con Shopify', {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setIsSyncing(false);
      }
    },
    [activeBusinessId, refresh],
  );

  return { status, isLoading, isVerifying, isSyncing, error, refresh, verify, sync };
}
