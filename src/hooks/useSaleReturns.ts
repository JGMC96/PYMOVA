import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { pushShopifyStock, pushShopifyPosRefunds, pushStockagileReturns } from '@/lib/shopifyStockPush';
import type { TicketDoc } from '@/lib/ticket';

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

/** Devolución leída de la base de datos → ticket de abono. */
export function refundTicketDoc(
  row: {
    return_number: string;
    refund_method: string | null;
    reason: string | null;
    total: number | string;
    created_at: string;
    sales: { sale_number: string } | null;
    sale_return_items: { product_name: string; quantity: number | string; unit_price: number | string; total: number | string | null }[];
    /** Vale creado con la devolución (reembolso «Vale de tienda»). */
    store_vouchers?: { code: string; initial_amount: number | string; expires_at: string | null }[] | null;
  },
  taxRate: number,
  cashier: string | null,
): TicketDoc {
  return {
    kind: 'refund',
    number: row.return_number,
    originalNumber: row.sales?.sale_number ?? null,
    createdAt: new Date(row.created_at),
    taxRate,
    total: Number(row.total),
    paymentMethod: row.refund_method ?? undefined,
    notes: row.reason,
    cashier,
    voucherIssued: row.store_vouchers?.[0]
      ? {
          code: row.store_vouchers[0].code,
          amount: Number(row.store_vouchers[0].initial_amount),
          expiresAt: row.store_vouchers[0].expires_at ? new Date(row.store_vouchers[0].expires_at) : null,
        }
      : null,
    lines: row.sale_return_items.map((i) => {
      const quantity = Number(i.quantity);
      const total = i.total != null ? Number(i.total) : quantity * Number(i.unit_price);
      return { name: i.product_name, quantity, unitPrice: Number(i.unit_price), total };
    }),
  };
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
      sellerSessionId?: string | null;
      authorizationId?: string | null;
    }): Promise<{ id: string; number: string } | null> => {
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
        _items: items,
        _reason: params.reason || null,
        _refund_method: params.refundMethod || null,
        _restock: params.restock ?? true,
        // Parámetro nuevo de la 0027: `as never` hasta que se regenere types.ts.
        _seller_session_id: params.sellerSessionId ?? null,
        _authorization_id: params.authorizationId ?? null,
      } as never);
      setIsSubmitting(false);

      if (error) {
        console.error('Error creating return:', error);
        toast.error(error.message || 'Error al registrar la devolución');
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const bizId = activeBusiness.id;
      void ((params.restock ?? true) ? pushShopifyStock(bizId) : Promise.resolve()).then(() =>
        pushShopifyPosRefunds(bizId)
      );
      if (params.restock ?? true) void pushStockagileReturns(bizId);
      toast.success(`Devolución ${row?.return_number} registrada`);
      return row?.return_id ? { id: row.return_id as string, number: row.return_number as string } : null;
    },
    [activeBusiness?.id]
  );

  /** Ticket de abono de una devolución (para imprimirlo o reimprimirlo). */
  const fetchRefundTicket = useCallback(
    async (returnId: string, taxRate: number): Promise<TicketDoc | null> => {
      const { data, error } = await supabase
        .from('sale_returns')
        .select('return_number, refund_method, reason, total, created_at, seller_employee_id, sales(sale_number), sale_return_items(product_name, quantity, unit_price, total), store_vouchers(code, initial_amount, expires_at)')
        .eq('id', returnId)
        .maybeSingle();
      if (error || !data) {
        toast.error('No se pudo cargar el ticket de la devolución');
        return null;
      }
      const row = data as unknown as {
        return_number: string;
        refund_method: string | null;
        reason: string | null;
        total: number | string;
        created_at: string;
        seller_employee_id: string | null;
        sales: { sale_number: string } | null;
        sale_return_items: { product_name: string; quantity: number | string; unit_price: number | string; total: number | string | null }[];
        store_vouchers: { code: string; initial_amount: number | string; expires_at: string | null }[] | null;
      };
      let cashier: string | null = null;
      if (row.seller_employee_id) {
        const { data: name } = await supabase.rpc('employee_display_name' as never, { _employee_id: row.seller_employee_id } as never);
        cashier = typeof name === 'string' ? name : null;
      }
      return refundTicketDoc(row, taxRate, cashier);
    },
    [],
  );

  return { fetchSaleDetail, fetchReturns, createReturn, fetchRefundTicket, isLoading, isSubmitting };
}
