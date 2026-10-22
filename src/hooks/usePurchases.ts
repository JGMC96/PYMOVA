// Compras a proveedor (0040): lectura de compras, proveedores y ubicaciones, y las acciones
// (guardar, pasar a pedida, cancelar y recibir). Todo se escribe por funciones del servidor.
import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import type { PurchaseItem, PurchaseStatus } from '@/lib/compras';

export interface Supplier {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
}

export interface StockLocation {
  location_gid: string;
  location_name: string | null;
  is_default: boolean;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  location_gid: string | null;
  location_name: string | null;
  season: string | null;
  expected_at: string | null;
  notes: string | null;
  status: PurchaseStatus;
  created_at: string;
  items: PurchaseItem[];
}

export interface PurchaseDraftLine {
  variant_id: string | null;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
  discount_pct: number;
}

export interface PurchaseDraft {
  id: string | null;
  supplier_id: string | null;
  location_gid: string | null;
  season: string;
  expected_at: string | null;
  notes: string;
  lines: PurchaseDraftLine[];
}

// Tablas y funciones nuevas de la 0040: `as never` hasta que se regenere types.ts.
const db = supabase as unknown as {
  from: (t: string) => ReturnType<typeof supabase.from>;
  rpc: (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>;
};

export function usePurchases() {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?.id ?? null;
  const [isSaving, setIsSaving] = useState(false);

  const fetchOrders = useCallback(async (): Promise<PurchaseOrder[]> => {
    if (!businessId) return [];
    const { data, error } = await db
      .from('purchase_orders')
      .select('id, number, supplier_id, location_gid, location_name, season, expected_at, notes, status, created_at, suppliers(name), purchase_order_items(id, variant_id, product_id, product_name, sku, barcode, qty_ordered, qty_received, unit_cost, discount_pct)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error('No se pudieron cargar las compras');
      return [];
    }
    type Row = Omit<PurchaseOrder, 'supplier_name' | 'items'> & {
      suppliers: { name: string } | null;
      purchase_order_items: PurchaseItem[];
    };
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      ...r,
      supplier_name: r.suppliers?.name ?? null,
      items: (r.purchase_order_items ?? [])
        .map((i) => ({ ...i, unit_cost: Number(i.unit_cost), discount_pct: Number(i.discount_pct) }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name, 'es')),
    }));
  }, [businessId]);

  const fetchSuppliers = useCallback(async (): Promise<Supplier[]> => {
    if (!businessId) return [];
    const { data } = await db
      .from('suppliers')
      .select('id, name, tax_id, email, phone')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name');
    return (data ?? []) as unknown as Supplier[];
  }, [businessId]);

  const fetchLocations = useCallback(async (): Promise<StockLocation[]> => {
    if (!businessId) return [];
    const { data } = await db.rpc('get_stock_locations', { _business_id: businessId });
    return (data ?? []) as unknown as StockLocation[];
  }, [businessId]);

  const run = useCallback(async <T,>(fn: () => Promise<{ data: unknown; error: { message?: string } | null }>, ok?: string) => {
    setIsSaving(true);
    const { data, error } = await fn();
    setIsSaving(false);
    if (error) {
      toast.error(error.message || 'No se pudo guardar');
      return null;
    }
    if (ok) toast.success(ok);
    return data as T;
  }, []);

  const saveSupplier = useCallback(
    (name: string, taxId?: string) =>
      run<string>(
        () => db.rpc('save_supplier', { _business_id: businessId, _supplier_id: null, _name: name, _tax_id: taxId ?? null }) as never,
        'Proveedor guardado',
      ),
    [businessId, run],
  );

  const saveOrder = useCallback(
    async (draft: PurchaseDraft) => {
      const rows = await run<{ order_id: string; order_number: string }[]>(
        () =>
          db.rpc('save_purchase_order', {
            _business_id: businessId,
            _order_id: draft.id,
            _supplier_id: draft.supplier_id,
            _location_gid: draft.location_gid,
            _season: draft.season || null,
            _expected_at: draft.expected_at || null,
            _notes: draft.notes || null,
            _items: draft.lines,
          }) as never,
      );
      const row = rows?.[0] ?? null;
      if (row) toast.success(`Compra ${row.order_number} guardada`);
      return row;
    },
    [businessId, run],
  );

  const setStatus = useCallback(
    (orderId: string, status: 'ordered' | 'cancelled') =>
      run<null>(
        () => db.rpc('set_purchase_order_status', { _business_id: businessId, _order_id: orderId, _status: status }) as never,
        status === 'ordered' ? 'Compra marcada como pedida' : 'Compra cancelada',
      ),
    [businessId, run],
  );

  const receive = useCallback(
    (orderId: string, lines: { item_id: string; quantity: number }[], notes?: string) =>
      run<string>(
        () => db.rpc('receive_purchase_order', { _business_id: businessId, _order_id: orderId, _lines: lines, _notes: notes ?? null }) as never,
        'Recepción guardada: stock actualizado',
      ),
    [businessId, run],
  );

  return { fetchOrders, fetchSuppliers, fetchLocations, saveSupplier, saveOrder, setStatus, receive, isSaving };
}
