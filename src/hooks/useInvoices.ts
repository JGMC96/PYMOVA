import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { Invoice, InvoiceStatus } from '@/types/database';

export interface InvoiceWithClient extends Invoice {
  client_name?: string;
}

export interface InvoiceItemInput {
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
}

export interface CreateInvoiceData {
  client_id: string;
  due_date?: string;
  notes?: string;
  items: InvoiceItemInput[];
}

interface UseInvoicesReturn {
  invoices: InvoiceWithClient[];
  isLoading: boolean;
  error: Error | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  statusFilter: InvoiceStatus | 'all';
  setStatusFilter: (status: InvoiceStatus | 'all') => void;
  fetchInvoices: () => Promise<void>;
  generateInvoiceNumber: () => Promise<string | null>;
  createInvoice: (data: CreateInvoiceData) => Promise<boolean>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<boolean>;
}

// Sanitize search term to prevent .or() parsing issues
function sanitizeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[,();]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useInvoices(): UseInvoicesReturn {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');

  // Request ID counter for race condition protection
  const requestIdRef = useRef(0);

  // Single unified fetch function with race condition protection
  const runFetch = useCallback(async (requestId: number) => {
    if (!activeBusinessId) {
      if (requestId === requestIdRef.current) {
        setInvoices([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      // Build query with join to clients for client name
      let query = supabase
        .from('invoices')
        .select(`
          *,
          clients!invoices_client_id_fkey (name)
        `)
        .eq('business_id', activeBusinessId)
        .order('created_at', { ascending: false });

      // Status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // Search filter (invoice_number or client name)
      const sanitizedTerm = sanitizeSearchTerm(searchTerm);
      if (sanitizedTerm) {
        query = query.or(
          `invoice_number.ilike.%${sanitizedTerm}%`
        );
      }

      const { data, error: fetchError } = await query;

      // Only update state if this is still the current request
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (fetchError) {
        throw fetchError;
      }

      // Map data to include client_name
      const mappedInvoices: InvoiceWithClient[] = (data || []).map((invoice: any) => ({
        ...invoice,
        client_name: invoice.clients?.name || null,
        clients: undefined, // Remove the nested object
      }));

      setInvoices(mappedInvoices);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      console.error('Error fetching invoices:', err);
      setError(err instanceof Error ? err : new Error('Error al cargar facturas'));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeBusinessId, searchTerm, statusFilter]);

  // Public fetch function that increments request ID
  const fetchInvoices = useCallback(async () => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    await runFetch(newRequestId);
  }, [runFetch]);

  // Effect for initial load and dependency changes
  useEffect(() => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    runFetch(newRequestId);
  }, [runFetch]);

  // Generate invoice number via RPC
  const generateInvoiceNumber = useCallback(async (): Promise<string | null> => {
    if (!activeBusinessId) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('generate_invoice_number', {
        _business_id: activeBusinessId,
      });

      if (rpcError) {
        throw rpcError;
      }

      return data as string;
    } catch (err) {
      console.error('Error generating invoice number:', err);
      toast({
        title: 'Error al generar número de factura',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return null;
    }
  }, [activeBusinessId, toast]);

  // Create invoice with items using transactional RPC
  const createInvoice = useCallback(async (data: CreateInvoiceData): Promise<boolean> => {
    if (!activeBusinessId || !user) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    try {
      // Convert items to JSONB format for the RPC
      const itemsJson = data.items.map((item) => ({
        product_id: item.product_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));

      // Call transactional RPC - generates invoice number atomically
      const { data: result, error: rpcError } = await supabase.rpc('create_invoice_with_items', {
        _business_id: activeBusinessId,
        _client_id: data.client_id,
        _items: itemsJson,
        _due_date: data.due_date || null,
        _notes: data.notes || null,
      });

      if (rpcError) {
        throw rpcError;
      }

      const invoiceNumber = result?.[0]?.invoice_number || 'Nueva';
      
      toast({
        title: 'Factura creada',
        description: `Factura ${invoiceNumber} creada correctamente`,
      });

      await fetchInvoices();
      return true;
    } catch (err) {
      console.error('Error creating invoice:', err);
      toast({
        title: 'Error al crear factura',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, user, fetchInvoices, toast]);

  // Emitir o cancelar por RPC (0050): «pagada» y «vencida» salen de los cobros.
  const updateInvoiceStatus = useCallback(async (id: string, status: InvoiceStatus): Promise<boolean> => {
    if (!activeBusinessId) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const { data: newStatus, error: rpcError } = await supabase.rpc('set_invoice_status', {
        _business_id: activeBusinessId,
        _invoice_id: id,
        _status: status,
      });

      if (rpcError) {
        throw rpcError;
      }

      const statusLabels: Record<InvoiceStatus, string> = {
        draft: 'Borrador',
        sent: 'Enviada',
        paid: 'Pagada',
        overdue: 'Vencida',
        cancelled: 'Cancelada',
      };

      toast({
        title: 'Estado actualizado',
        description: `Factura marcada como ${statusLabels[(newStatus as InvoiceStatus) || status]}`,
      });

      await fetchInvoices();
      return true;
    } catch (err) {
      console.error('Error updating invoice status:', err);
      toast({
        title: 'Error al actualizar estado',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, fetchInvoices, toast]);

  return {
    invoices,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    fetchInvoices,
    generateInvoiceNumber,
    createInvoice,
    updateInvoiceStatus,
  };
}
