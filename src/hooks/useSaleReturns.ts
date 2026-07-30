import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

export interface SaleDetailLine {
  sale_item_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  returned_quantity: number;
}

export interface SaleReturn {
  id: string;
  sale_id: string;
  return_number: string;
  reason: string | null;
  refund_method: string | null;
  total: number;
  created_at: string;
}

export function useSaleReturns() {
  const { activeBusiness } = useBusiness();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchSaleDetail = useCallback(async (saleId: string): Promise<SaleDetailLine[]> => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('get_sale_detail', { _sale_id: saleId });
    setIsLoading(false);

    if (error) {
      console.error('Error fetching sale detail:', error);
      toast.error(error.message || 'Error al cargar el detalle de la venta');
      return [];
    }
    return (data || []) as SaleDetailLine[];
  }, []);

  const fetchReturns = useCallback(async (saleId?: string): Promise<SaleReturn[]> => {
    if (!activeBusiness?.id) return [];
    let query = supabase
      .from('sale_returns')
      .select('id, sale_id, return_number, reason, refund_method, total, created_at')
      .eq('business_id', activeBusiness.id)
      .order('created_at', { ascending: false });

    if (saleId) query = query.eq('sale_id', saleId);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching returns:', error);
      return [];
    }
    return (data || []) as SaleReturn[];
  }, [activeBusiness?.id]);

  const createReturn = useCallback(
    async (params: {
      saleId: string;
      items: { sale_item_id: string; quantity: number }[];
      reason?: string;
      refundMethod?: string;
      restock?: boolean;
    }): Promise<string | null> => {
      if (!activeBusiness?.id) {
        toast.error('No hay negocio activo');
        return null;
      }

      const items = params.items.filter((i) => i.quantity > 0);
      if (items.length === 0) {
        toast.error('Selecciona al menos una unidad a devolver');
        return null;
      }

      setIsSubmitting(true);
      const { data, error } = await supabase.rpc('create_sale_return', {
        _business_id: activeBusiness.id,
        _sale_id: params.saleId,
        _items: items as any,
        _reason: params.reason || null,
        _refund_method: params.refundMethod || null,
        _restock: params.restock ?? true,
      });
      setIsSubmitting(false);

      if (error) {
        console.error('Error creating return:', error);
        toast.error(error.message || 'Error al registrar la devolución');
        return null;
      }

      const row = Array.isArray(data) ? data[0] : (data as any);
      toast.success(`Devolución ${row?.return_number} registrada`);
      return row?.return_number ?? null;
    },
    [activeBusiness?.id]
  );

  return { fetchSaleDetail, fetchReturns, createReturn, isLoading, isSubmitting };
}
