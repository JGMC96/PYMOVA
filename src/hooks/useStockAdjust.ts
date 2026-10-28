import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { pushShopifyStock, pushStockagileMoves } from '@/lib/shopifyStockPush';
import type { StockLine } from '@/lib/stockAdjust';

/** ok: guardado (o nada que cambiar); conflict: el stock cambió mientras se editaba; error: no se guardó. */
export type StockAdjustResult = 'ok' | 'conflict' | 'error' | 'cancelled';

/**
 * ¿Se ve el botón de ajustar? Con dependientes con PIN, si alguien con PIN tiene el permiso
 * (lo decide la persona, no la cuenta); sin ellos, el permiso de la cuenta. Lo comprueba el servidor.
 */
export function useCanAdjustStock(): boolean {
  const { canAdjustStock } = useMyPermissions();
  const { requiresSeller, authorizersFor } = useSellerSession();
  return requiresSeller ? authorizersFor('adjust_stock').length > 0 : canAdjustStock;
}

/**
 * Ajuste manual de stock, con motivo: una o varias tallas de un producto, todo o nada
 * (adjust_stock_batch, 0057). Con dependientes con PIN, cada guardado pide el PIN de quien lo
 * hace. Queda en el historial y el cambio se manda a Stockagile si el negocio lo tiene
 * conectado (él lo pasa a Shopify) o, si no, a Shopify.
 */
export function useStockAdjust() {
  const { activeBusiness } = useBusiness();
  const { requiresSeller, authorize } = useSellerSession();
  const [isAdjusting, setIsAdjusting] = useState(false);

  const adjustLines = useCallback(
    async (productId: string, lines: StockLine[], reason: string): Promise<StockAdjustResult> => {
      if (!activeBusiness?.id) return 'error';
      if (lines.length === 0) {
        toast.info('No hay cambios que guardar');
        return 'ok';
      }
      let authorizationId: string | null = null;
      if (requiresSeller) {
        authorizationId = await authorize('adjust_stock', 'el ajuste de stock');
        if (!authorizationId) return 'cancelled';
      }
      setIsAdjusting(true);
      // RPC nueva de la 0057: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('adjust_stock_batch' as never, {
        _business_id: activeBusiness.id,
        _product_id: productId,
        _lines: lines,
        _reason: reason,
        _authorization_id: authorizationId,
      } as never);
      setIsAdjusting(false);

      if (error) {
        const conflict = (error as { code?: string }).code === '40001';
        toast.error(conflict ? 'El stock ha cambiado' : 'No se pudo ajustar el stock', { description: error.message });
        return conflict ? 'conflict' : 'error';
      }
      const row = ((data ?? []) as { changed: number; to_stockagile: boolean }[])[0];
      const changed = Number(row?.changed ?? 0);
      if (changed === 0) {
        toast.info('El stock ya tenía esas cantidades');
      } else {
        toast.success(changed === 1 ? 'Stock ajustado' : `Stock ajustado en ${changed} tallas`);
        if (row?.to_stockagile) void pushStockagileMoves(activeBusiness.id);
        else void pushShopifyStock(activeBusiness.id);
      }
      return 'ok';
    },
    [activeBusiness?.id, requiresSeller, authorize],
  );

  return { adjustLines, isAdjusting };
}
