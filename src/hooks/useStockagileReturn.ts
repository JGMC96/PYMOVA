import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/contexts/BusinessContext';
import { supabase } from '@/integrations/supabase/client';
import { pushShopifyStock, pushStockagileMoves } from '@/lib/shopifyStockPush';
import { parseVariantSearch, stockagileVoucherPaid, type PickedVariant, type ReturnableTicket } from '@/lib/stockagileReturn';

/** Devolución hecha en PYMOVA de un ticket de Stockagile. */
export interface StockagileTicketReturn {
  id: string;
  return_number: string;
  total: number;
  stockagile_sale_id: string;
}

interface FoundVariant {
  id: string;
  name: string;
  products: { name: string };
}

const MAX_RESULTS = 8;

/** Devolver tickets de Stockagile (0060). `as never`: RPC y columnas nuevas hasta regenerar types.ts. */
export function useStockagileReturn() {
  const { activeBusinessId } = useBusiness();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchReturnable = useCallback(
    async (saleId: string): Promise<ReturnableTicket | null> => {
      if (!activeBusinessId) return null;
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_stockagile_returnable' as never, {
        _business_id: activeBusinessId,
        _sale_id: saleId,
      } as never);
      if (error) {
        setIsLoading(false);
        console.error('Error fetching returnable ticket:', error);
        toast.error(error.message || 'No se pudo cargar el ticket');
        return null;
      }
      // Vale gastado en el ticket: la RPC no lo devuelve (no es un artículo). Si falla, sin aviso.
      const { data: negatives } = await supabase
        .from('stockagile_sale_items')
        .select('product_name, total')
        .eq('sale_id', saleId)
        .lt('total', 0);
      setIsLoading(false);
      return { ...(data as unknown as ReturnableTicket), voucher_paid: stockagileVoucherPaid(negatives ?? []) };
    },
    [activeBusinessId],
  );

  const fetchTicketReturns = useCallback(async (): Promise<StockagileTicketReturn[]> => {
    if (!activeBusinessId) return [];
    const { data, error } = await supabase
      .from('sale_returns')
      .select('id, return_number, total, stockagile_sale_id' as never)
      .eq('business_id', activeBusinessId)
      .not('stockagile_sale_id' as never, 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) {
      console.error('Error fetching ticket returns:', error);
      return [];
    }
    return (data ?? []) as unknown as StockagileTicketReturn[];
  }, [activeBusinessId]);

  /** Tallas del catálogo por código de barras o por nombre. Nunca por SKU: hay repetidos. */
  const searchVariants = useCallback(
    async (raw: string): Promise<PickedVariant[]> => {
      const search = parseVariantSearch(raw);
      if (!activeBusinessId || !search) return [];
      let query = supabase
        .from('product_variants')
        .select('id, name, products!inner(name)')
        .eq('business_id', activeBusinessId);
      if ('barcode' in search) {
        query = query.eq('barcode', search.barcode);
      } else {
        query = query.ilike('products.name', `%${search.name.replace(/[%_]/g, '\\$&').replace(/ /g, '%')}%`);
        if (search.size) query = query.eq('name', search.size);
      }
      const { data, error } = await query.order('name').limit(MAX_RESULTS);
      if (error) {
        console.error('Error searching variants:', error);
        return [];
      }
      return ((data ?? []) as unknown as FoundVariant[]).map((v) => ({
        id: v.id,
        label: `${v.products.name} · ${v.name}`,
      }));
    },
    [activeBusinessId],
  );

  const createReturn = useCallback(
    async (params: {
      saleId: string;
      items: { line_key: string; quantity: number; variant_id: string | null }[];
      reason: string;
      refundMethod: string;
      restock: boolean;
      sellerSessionId: string | null;
      authorizationId: string | null;
    }): Promise<{ id: string; number: string } | null> => {
      if (!activeBusinessId) return null;
      setIsSubmitting(true);
      const { data, error } = await supabase.rpc('create_stockagile_return' as never, {
        _business_id: activeBusinessId,
        _sale_id: params.saleId,
        _items: params.items,
        _reason: params.reason || null,
        _refund_method: params.refundMethod,
        _restock: params.restock,
        _seller_session_id: params.sellerSessionId,
        _authorization_id: params.authorizationId,
      } as never);
      setIsSubmitting(false);
      if (error) {
        console.error('Error creating Stockagile return:', error);
        toast.error(error.message || 'No se pudo registrar la devolución');
        return null;
      }
      const row = (data as unknown as { return_id: string; return_number: string }[])[0];
      // Primero Shopify, después Stockagile. El servidor también lo garantiza (docs/STOCK.md).
      if (params.restock) {
        void pushShopifyStock(activeBusinessId).then(() => pushStockagileMoves(activeBusinessId));
      }
      toast.success(`Devolución ${row.return_number} registrada`);
      return { id: row.return_id, number: row.return_number };
    },
    [activeBusinessId],
  );

  return { fetchReturnable, fetchTicketReturns, searchVariants, createReturn, isLoading, isSubmitting };
}
