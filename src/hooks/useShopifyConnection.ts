import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/contexts/BusinessContext';
import { invokeShopifySync, refreshShopifyStock } from '@/lib/shopify';

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
    /** Último refresco del stock desde Shopify (botón o tarea nocturna). */
    last_stock_refresh_at?: string | null;
    last_stock_refresh_status?: string | null;
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
  /** Productos procesados en la sincronización del catálogo en curso. */
  const [syncProgress, setSyncProgress] = useState(0);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
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
      const result = await invokeShopifySync<{
        shop_name: string;
        missing: string[];
        can_push_stock?: boolean;
      }>({
        action: 'verify',
        business_id: activeBusinessId,
      });
      if (result.missing?.length) {
        toast.warning('Conexión establecida con permisos incompletos', {
          description: `Faltan alcances: ${result.missing.join(', ')}`,
        });
      } else if (result.can_push_stock === false) {
        toast.success(`Conexión correcta con ${result.shop_name}`, {
          description:
            'La escritura de inventario en Shopify sigue sin estar concedida: los ajustes de stock desde la tienda física quedarán en espera hasta que amplíes los permisos de la app.',
        });
      } else {
        toast.success(`Conexión correcta con ${result.shop_name}`, {
          description: result.can_push_stock
            ? 'Escritura de inventario concedida: las ventas y devoluciones ajustan también el stock de Shopify.'
            : undefined,
        });
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
      setSyncProgress(0);
      try {
        type SyncResponse = {
          message: string;
          failed: number;
          created?: number;
          updated?: number;
          partial?: boolean;
          next_cursor?: string | null;
          run_id?: string;
        };
        // El catálogo llega por lotes: se encadenan llamadas hasta que no queda cursor.
        let after: string | null = null;
        let runId: string | null = null;
        let result: SyncResponse;
        for (let batch = 0; ; batch++) {
          result = await invokeShopifySync<SyncResponse>({
            action: 'sync',
            business_id: activeBusinessId,
            scope,
            after,
            run_id: runId,
            max_pages: 3,
          });
          setSyncProgress((result.created ?? 0) + (result.updated ?? 0) + (result.failed ?? 0));
          if (!result.partial || !result.next_cursor || batch >= 100) break;
          after = result.next_cursor;
          runId = result.run_id ?? runId;
        }
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

  /** Vincula la tienda a este negocio (una tienda = un negocio, para siempre). */
  const claim = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsClaiming(true);
    try {
      await invokeShopifySync({ action: 'claim', business_id: activeBusinessId });
      toast.success('Tienda vinculada a este negocio');
      await refresh();
    } catch (err) {
      toast.error('No se pudo vincular la tienda', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsClaiming(false);
    }
  }, [activeBusinessId, refresh]);

  /** Pone el stock de Pymova al día con Shopify (solo la ubicación de la tienda). */
  const refreshStock = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsRefreshingStock(true);
    try {
      const result = await refreshShopifyStock(activeBusinessId);
      toast.success('Stock actualizado desde Shopify', {
        description: `${result.items} artículos revisados (${result.applied} niveles aplicados).`,
      });
      await refresh();
    } catch (err) {
      toast.error('No se pudo actualizar el stock desde Shopify', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsRefreshingStock(false);
    }
  }, [activeBusinessId, refresh]);

  /** Procesa los webhooks pendientes en cola. */
  const processWebhooks = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      const result = await invokeShopifySync<{ handled: number }>({
        action: 'process-webhooks',
        business_id: activeBusinessId,
      });
      toast.success(`${result.handled} avisos procesados`);
      await refresh();
    } catch (err) {
      toast.error('No se pudieron procesar los avisos pendientes', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [activeBusinessId, refresh]);

  return {
    status,
    isLoading,
    isVerifying,
    isSyncing,
    syncProgress,
    isClaiming,
    error,
    refresh,
    verify,
    sync,
    claim,
    processWebhooks,
    refreshStock,
    isRefreshingStock,
  };
}

