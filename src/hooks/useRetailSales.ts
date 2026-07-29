import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

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
        (data || []).map((sale: any) => ({
          ...sale,
          client_name: sale.clients?.name || 'Mostrador',
        }))
      );
    }
    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const createSale = async (data: CreateSaleData): Promise<{ id: string; sale_number: string } | null> => {
    if (!activeBusiness?.id) {
      toast.error('No hay negocio activo');
      return null;
    }

    setIsCreating(true);

    try {
      // Generate sale number
      const { data: saleNumberData, error: saleNumberError } = await supabase
        .rpc('generate_sale_number', { _business_id: activeBusiness.id });

      if (saleNumberError) throw saleNumberError;

      const saleNumber = saleNumberData as string;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Insert sale
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          business_id: activeBusiness.id,
          sale_number: saleNumber,
          client_id: data.client_id || null,
          subtotal: data.subtotal,
          tax: data.tax,
          total: data.total,
          discount: data.discount ?? 0,
          tip: data.tip ?? 0,
          cash_received: data.cash_received ?? null,
          change_given: data.change_given ?? null,
          register_session_id: data.register_session_id ?? null,
          payment_method: data.payment_method,
          notes: data.notes || null,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (saleError) throw saleError;

      // Insert sale items
      const saleItems = data.items.map(item => ({
        sale_id: sale.id,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount ?? 0,
        total: item.total,
      }));

      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;


      toast.success(`Venta ${saleNumber} registrada`);
      fetchSales();
      return { id: sale.id, sale_number: saleNumber };
    } catch (error: any) {
      console.error('Error creating sale:', error);
      toast.error('Error al registrar venta');
      return null;
    } finally {
      setIsCreating(false);
    }
  };

  return {
    sales,
    isLoading,
    isCreating,
    createSale,
    refreshSales: fetchSales,
  };
}
