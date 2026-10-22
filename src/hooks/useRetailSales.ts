import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { pushShopifyStock, pushShopifyPosOrders, pushShopifyPosRefunds } from '@/lib/shopifyStockPush';

export interface Sale {
  id: string;
  business_id: string;
  sale_number: string;
  client_id: string | null;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: string | null;
  notes: string | null;
  created_by: string | null;
  /** Dependiente que atendió (hr_employees), o null. */
  seller_employee_id?: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface SaleWithClient extends Sale {
  client_name?: string;
}

export interface CartItem {
  product_id: string;
  variant_id?: string | null;
  /** Línea libre «Varios»: sin producto del catálogo ni stock (product_id es solo su clave local). */
  custom?: boolean;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
}

export interface CreateSaleData {
  client_id?: string | null;
  payment_method: string;
  notes?: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  discount?: number;
  tip?: number;
  cash_received?: number | null;
  change_given?: number | null;
  register_session_id?: string | null;
  /** Sesión de vendedor abierta con el PIN; el servidor resuelve el vendedor. */
  seller_session_id?: string | null;
  /** Autorización de un encargado para un descuento por encima del tope (0030). */
  authorization_id?: string | null;
  /** Vale de tienda con el que se paga parte o todo el total (0039). */
  voucher_code?: string | null;
  voucher_amount?: number | null;
}


export function useRetailSales() {
  const { activeBusiness } = useBusiness();
  const [sales, setSales] = useState<SaleWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const fetchSales = useCallback(async () => {
    if (!activeBusiness?.id) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select(`
        *,
        clients(name)
      `)
      .eq('business_id', activeBusiness.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching sales:', error);
      toast.error('Error al cargar ventas');
    } else {
      setSales(
        (data || []).map((sale) => {
          const row = sale as SaleWithClient & { clients?: { name?: string } | null };
          return { ...row, client_name: row.clients?.name || 'Mostrador' };
        })
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const createSale = async (
    data: CreateSaleData,
    opts: { onError?: (message: string) => void } = {},
  ): Promise<{ id: string; sale_number: string } | null> => {
    if (!activeBusiness?.id) {
      toast.error('No hay negocio activo');
      return null;
    }

    setIsCreating(true);

    try {
      // Atomic: sale + items in a single transaction (stock is decremented by trigger)
      const { data: result, error } = await supabase.rpc('create_sale_with_items', {
        _business_id: activeBusiness.id,
        _items: data.items.map((item) => ({
          product_id: item.custom ? null : item.product_id || null,
          variant_id: item.custom ? null : item.variant_id ?? null,
          custom: item.custom ?? false,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount: item.discount ?? 0,
          total: item.total,
        })) as unknown as Json,
        _payment_method: data.payment_method,
        _client_id: data.client_id || null,
        _notes: data.notes || null,
        _subtotal: data.subtotal,
        _tax: data.tax,
        _total: data.total,
        _discount: data.discount ?? 0,
        _tip: data.tip ?? 0,
        _cash_received: data.cash_received ?? null,
        _change_given: data.change_given ?? null,
        _register_session_id: data.register_session_id ?? null,
        // Parámetro nuevo de la 0027: `as never` hasta que se regenere types.ts.
        _seller_session_id: data.seller_session_id ?? null,
        _authorization_id: data.authorization_id ?? null,
        _voucher_code: data.voucher_code ?? null,
        _voucher_amount: data.voucher_amount ?? null,
      } as never);

      if (error) throw error;

      const row = (Array.isArray(result) ? result[0] : result) as { sale_id: string; sale_number: string };
      const sale = { id: row.sale_id as string };
      const saleNumber = row.sale_number as string;



      toast.success(`Venta ${saleNumber} registrada`);
      void pushShopifyStock(activeBusiness.id)
        .then(() => pushShopifyPosOrders(activeBusiness.id))
        .then(() => pushShopifyPosRefunds(activeBusiness.id));
      fetchSales();
      return { id: sale.id, sale_number: saleNumber };
    } catch (error) {
      console.error('Error creating sale:', error);
      const message = (error as { message?: string } | null)?.message || 'Error al registrar venta';
      toast.error(message);
      opts.onError?.(message);
      return null;

    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Busca una venta por su número de ticket («VTA-000123») o por el de una de sus
   * devoluciones («DEV-000012»), aunque no esté entre las últimas 100 cargadas.
   */
  const findSaleByTicket = useCallback(
    async (code: string): Promise<SaleWithClient | null> => {
      if (!activeBusiness?.id) return null;
      let saleNumber = code;
      if (code.startsWith('DEV-')) {
        const { data: ret } = await supabase
          .from('sale_returns')
          .select('sale_id')
          .eq('business_id', activeBusiness.id)
          .eq('return_number', code)
          .maybeSingle();
        if (!ret) return null;
        const { data: sale } = await supabase
          .from('sales')
          .select('sale_number')
          .eq('id', ret.sale_id)
          .maybeSingle();
        if (!sale) return null;
        saleNumber = sale.sale_number;
      }
      const { data, error } = await supabase
        .from('sales')
        .select('*, clients(name)')
        .eq('business_id', activeBusiness.id)
        .eq('sale_number', saleNumber)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as SaleWithClient & { clients?: { name?: string } | null };
      return { ...row, client_name: row.clients?.name || 'Mostrador' };
    },
    [activeBusiness?.id],
  );

  return {
    sales,
    isLoading,
    isCreating,
    createSale,
    findSaleByTicket,
    refreshSales: fetchSales,
  };
}
