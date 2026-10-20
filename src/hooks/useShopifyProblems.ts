import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { pushShopifyPosOrders, pushShopifyPosRefunds, pushShopifyStock } from '@/lib/shopifyStockPush';
import type { ShopifyProblem } from '@/lib/shopifyProblems';

// RPC nuevas de la 0032: `as never` hasta que se regenere types.ts.
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never);

/** Envíos a Shopify fallidos del negocio activo (solo administradores). */
export function useShopifyProblems() {
  const { activeBusinessId } = useBusiness();
  const { isAdmin } = useRoleAccess('admin');
  const [problems, setProblems] = useState<ShopifyProblem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeBusinessId || !isAdmin) {
      setProblems([]);
      return;
    }
    setIsLoading(true);
    const { data, error } = await rpc('get_shopify_problems', { _business_id: activeBusinessId });
    setIsLoading(false);
    if (error) {
      console.warn('get_shopify_problems', error.message);
      return;
    }
    setProblems((data ?? []) as ShopifyProblem[]);
  }, [activeBusinessId, isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Deja pendientes los fallos y lanza los envíos ya, sin esperar a la tarea programada. */
  const retry = useCallback(async () => {
    if (!activeBusinessId) return;
    setIsRetrying(true);
    const { data, error } = await rpc('retry_shopify_problems', { _business_id: activeBusinessId });
    if (error) {
      setIsRetrying(false);
      toast.error('No se pudo reintentar', { description: error.message });
      return;
    }
    await pushShopifyStock(activeBusinessId);
    await pushShopifyPosOrders(activeBusinessId);
    await pushShopifyPosRefunds(activeBusinessId);
    setIsRetrying(false);
    const rows = (data ?? null) as unknown;
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { sales_count: number; returns_count: number; stock_count: number; webhooks_count: number }
      | null;
    const total = (row?.sales_count ?? 0) + (row?.returns_count ?? 0) + (row?.stock_count ?? 0) + (row?.webhooks_count ?? 0);
    toast.success(total > 0 ? `Reintentando ${total} envíos a Shopify` : 'No había nada que reintentar');
    await refresh();
  }, [activeBusinessId, refresh]);

  return { problems, isLoading, isRetrying, refresh, retry, enabled: isAdmin };
}
