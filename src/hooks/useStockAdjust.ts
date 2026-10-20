import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { pushShopifyStock } from '@/lib/shopifyStockPush';

export interface StockAdjustment {
  productId: string;
  variantId: string | null;
  newQuantity: number;
  reason: string;
}

/**
 * Ajuste manual de stock (solo admins). Queda en el historial con su motivo y,
 * si el artículo está emparejado con Shopify, el cambio se manda a Shopify.
 */
export function useStockAdjust() {
  const { activeBusiness } = useBusiness();
  const [isAdjusting, setIsAdjusting] = useState(false);

  const adjust = useCallback(
    async (a: StockAdjustment): Promise<boolean> => {
      if (!activeBusiness?.id) return false;
      setIsAdjusting(true);
      // RPC nueva de la 0025: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('adjust_stock' as never, {
        _business_id: activeBusiness.id,
        _product_id: a.productId,
        _variant_id: a.variantId,
        _new_quantity: a.newQuantity,
        _reason: a.reason,
      } as never);
      setIsAdjusting(false);

      if (error) {
        toast.error('No se pudo ajustar el stock', { description: error.message });
        return false;
      }
      const delta = Number(data ?? 0);
      if (delta === 0) {
        toast.info('El stock ya tenía esa cantidad');
      } else {
        toast.success(`Stock ajustado (${delta > 0 ? '+' : ''}${delta})`);
        void pushShopifyStock(activeBusiness.id);
      }
      return true;
    },
    [activeBusiness?.id],
  );

  return { adjust, isAdjusting };
}
