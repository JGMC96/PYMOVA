import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { pushShopifyOrderStatus } from '@/hooks/useShopifyOrdersSync';

export type OnlineOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface OnlineOrderItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface OnlineOrder {
  id: string;
  order_number: string;
  source: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: string | null;
  status: OnlineOrderStatus;
  payment_status: string;
  payment_method: string | null;
  subtotal: number;
  shipping_cost: number;
  tax: number;
  discount: number;
  total: number;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  online_order_items: OnlineOrderItem[];
}

export interface NewOnlineOrderItem {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface NewOnlineOrder {
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  shipping_address?: string;
  shipping_cost?: number;
  tax?: number;
  discount?: number;
  payment_method?: string;
  payment_status?: string;
  source?: string;
  notes?: string;
  items: NewOnlineOrderItem[];
}

export const ORDER_STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
};

export function useOnlineOrders() {
  const { activeBusinessId } = useBusiness();
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OnlineOrderStatus | 'all'>('all');
  const requestIdRef = useRef(0);

  const fetchOrders = useCallback(async () => {
    if (!activeBusinessId) {
      setOrders([]);
      setIsLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    let query = supabase
      .from('online_orders')
      .select('*, online_order_items(*)')
      .eq('business_id', activeBusinessId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    const { data, error } = await query;
    if (requestId !== requestIdRef.current) return;

    if (error) {
      console.error('Error fetching online orders:', error);
      toast.error('No se pudieron cargar los pedidos online');
      setOrders([]);
    } else {
      setOrders((data ?? []) as unknown as OnlineOrder[]);
    }
    setIsLoading(false);
  }, [activeBusinessId, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const createOrder = useCallback(
    async (data: NewOnlineOrder) => {
      if (!activeBusinessId) return false;
      setIsSubmitting(true);
      try {
        const { data: result, error } = await supabase.rpc('create_online_order', {
          _business_id: activeBusinessId,
          _items: data.items as never,
          _customer_name: data.customer_name,
          _customer_email: data.customer_email || null,
          _customer_phone: data.customer_phone || null,
          _shipping_address: data.shipping_address || null,
          _shipping_cost: data.shipping_cost ?? 0,
          _tax: data.tax ?? 0,
          _discount: data.discount ?? 0,
          _payment_method: data.payment_method || null,
          _payment_status: data.payment_status || 'pending',
          _source: data.source || 'manual',
          _client_id: null,
          _notes: data.notes || null,
        });
        if (error) throw error;
        const row = Array.isArray(result) ? result[0] : (result as { order_number?: string });
        toast.success(`Pedido ${row?.order_number ?? ''} creado`);
        await fetchOrders();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        toast.error(`No se pudo crear el pedido: ${message}`);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeBusinessId, fetchOrders],
  );

  const setStatus = useCallback(
    async (orderId: string, status: OnlineOrderStatus, trackingNumber?: string) => {
      setIsSubmitting(true);
      try {
        const { error } = await supabase.rpc('set_online_order_status', {
          _order_id: orderId,
          _status: status,
          _tracking_number: trackingNumber || null,
        });
        if (error) throw error;
        toast.success(`Pedido marcado como ${ORDER_STATUS_LABEL[status].toLowerCase()}`);

        const order = orders.find((o) => o.id === orderId);
        if (
          activeBusinessId &&
          order?.source === 'shopify' &&
          (status === 'shipped' || status === 'cancelled')
        ) {
          try {
            await pushShopifyOrderStatus({
              businessId: activeBusinessId,
              orderId,
              status,
              trackingNumber: trackingNumber || null,
            });
            toast.success('Estado sincronizado con Shopify');
          } catch (err) {
            toast.warning(
              `El pedido se actualizó en Pymova, pero no en Shopify: ${
                err instanceof Error ? err.message : 'error desconocido'
              }`,
            );
          }
        }

        await fetchOrders();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        toast.error(message);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeBusinessId, fetchOrders, orders],
  );

  const createReturn = useCallback(
    async (
      orderId: string,
      payload: { kind: 'return' | 'exchange'; reason?: string; refund_method?: string; total: number; restock: boolean },
    ) => {
      setIsSubmitting(true);
      try {
        const { data, error } = await supabase.rpc('create_online_order_return', {
          _order_id: orderId,
          _kind: payload.kind,
          _reason: payload.reason || null,
          _refund_method: payload.refund_method || null,
          _total: payload.total,
          _restock: payload.restock,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : (data as { return_number?: string });
        toast.success(
          `${payload.kind === 'exchange' ? 'Cambio' : 'Devolución'} ${row?.return_number ?? ''} registrado`,
        );
        await fetchOrders();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        toast.error(message);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [fetchOrders],
  );

  return {
    orders,
    isLoading,
    isSubmitting,
    statusFilter,
    setStatusFilter,
    fetchOrders,
    createOrder,
    setStatus,
    createReturn,
  };
}
