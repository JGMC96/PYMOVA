import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { 
  Payment, 
  PaymentWithInvoice, 
  InvoiceForPayment, 
  CreatePaymentData,
  InvoiceStatus 
} from '@/types/database';

interface UsePaymentsReturn {
  payments: PaymentWithInvoice[];
  isLoading: boolean;
  error: Error | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  fetchPayments: () => Promise<void>;
  createPayment: (data: CreatePaymentData) => Promise<boolean>;
  fetchPayableInvoices: () => Promise<InvoiceForPayment[]>;
  deletePayment: (paymentId: string) => Promise<boolean>;
}

// Sanitize search term to prevent .or() parsing issues
function sanitizeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function usePayments(): UsePaymentsReturn {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();
  
  const [payments, setPayments] = useState<PaymentWithInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Request ID counter for race condition protection
  const requestIdRef = useRef(0);

  // Single unified fetch function with race condition protection
  const runFetch = useCallback(async (requestId: number) => {
    if (!activeBusinessId) {
      if (requestId === requestIdRef.current) {
        setPayments([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      let query = supabase
        .from('payments')
        .select(`
          *,
          invoices (
            invoice_number,
            total
          )
        `)
        .eq('business_id', activeBusinessId)
        .order('payment_date', { ascending: false });

      // Search filter by invoice number
      const sanitizedTerm = sanitizeSearchTerm(searchTerm);
      if (sanitizedTerm) {
        // For searching by invoice number, we need to filter after fetching
        // since PostgREST doesn't support filtering on joined columns easily
      }

      const { data, error: fetchError } = await query;

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (fetchError) {
        throw fetchError;
      }

      // Transform data to include invoice info and filter by search
      let transformedPayments: PaymentWithInvoice[] = (data || []).map((payment) => ({
        ...payment,
        invoice_number: payment.invoices?.invoice_number || undefined,
        invoice_total: payment.invoices?.total ? Number(payment.invoices.total) : undefined,
      }));

      // Filter by search term (invoice number or payment method)
      if (sanitizedTerm) {
        const lowerTerm = sanitizedTerm.toLowerCase();
        transformedPayments = transformedPayments.filter((p) =>
          p.invoice_number?.toLowerCase().includes(lowerTerm) ||
          p.payment_method?.toLowerCase().includes(lowerTerm)
        );
      }

      setPayments(transformedPayments);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      
      console.error('Error fetching payments:', err);
      setError(err instanceof Error ? err : new Error('Error al cargar pagos'));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeBusinessId, searchTerm]);

  // Public fetch function that increments request ID
  const fetchPayments = useCallback(async () => {
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

  // Create payment using atomic RPC (transactional)
  const createPayment = useCallback(async (data: CreatePaymentData): Promise<boolean> => {
    if (!activeBusinessId || !user) {
      toast({
        title: 'Error',
        description: 'No hay negocio activo',
        variant: 'destructive',
      });
      return false;
    }

    try {
      // Use atomic RPC to create payment and recalculate invoice status
      const { data: paymentId, error: rpcError } = await supabase
        .rpc('create_payment_and_recalc_invoice', {
          _business_id: activeBusinessId,
          _invoice_id: data.invoice_id,
          _amount: data.amount,
          _payment_method: data.payment_method || null,
          _payment_date: data.payment_date,
          _notes: data.notes || null,
        });

      if (rpcError) {
        throw rpcError;
      }

      toast({
        title: 'Pago registrado',
        description: 'El pago se ha registrado correctamente',
      });

      await fetchPayments();
      return true;
    } catch (err) {
      console.error('Error creating payment:', err);
      toast({
        title: 'Error al registrar pago',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, user, fetchPayments, toast]);

  // Anular un cobro por RPC (0050): la factura se recalcula y el borrado queda en auditoría.
  const deletePayment = useCallback(async (paymentId: string): Promise<boolean> => {
    if (!activeBusinessId) {
      return false;
    }

    try {
      const { error: rpcError } = await supabase.rpc('delete_payment_and_recalc_invoice', {
        _business_id: activeBusinessId,
        _payment_id: paymentId,
      });

      if (rpcError) {
        throw rpcError;
      }

      toast({
        title: 'Cobro anulado',
        description: 'La factura se ha recalculado',
      });

      await fetchPayments();
      return true;
    } catch (err) {
      console.error('Error deleting payment:', err);
      toast({
        title: 'Error al anular el cobro',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return false;
    }
  }, [activeBusinessId, fetchPayments, toast]);

  // Facturas que pueden recibir cobros: enviadas o vencidas, con algo pendiente
  const fetchPayableInvoices = useCallback(async (): Promise<InvoiceForPayment[]> => {
    if (!activeBusinessId) {
      return [];
    }

    try {
      // Get invoices that can receive payments (not draft or cancelled)
      const { data: invoices, error: invoicesError } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          total,
          status,
          due_date,
          clients (
            name
          )
        `)
        .eq('business_id', activeBusinessId)
        .in('status', ['sent', 'overdue'])
        .order('created_at', { ascending: false });

      if (invoicesError) {
        throw invoicesError;
      }

      // Get all payments to calculate totals
      const { data: allPayments, error: paymentsError } = await supabase
        .from('payments')
        .select('invoice_id, amount')
        .eq('business_id', activeBusinessId);

      if (paymentsError) {
        throw paymentsError;
      }

      // Calculate total paid per invoice
      const paidByInvoice: Record<string, number> = {};
      for (const payment of allPayments || []) {
        if (payment.invoice_id) {
          paidByInvoice[payment.invoice_id] = 
            (paidByInvoice[payment.invoice_id] || 0) + Number(payment.amount);
        }
      }

      // Transform to InvoiceForPayment (sin las ya cubiertas: no se cobra de más)
      return (invoices || []).map((inv) => {
        const totalPaid = paidByInvoice[inv.id] || 0;
        const total = Number(inv.total);
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          total,
          status: inv.status as InvoiceStatus,
          due_date: inv.due_date,
          client_name: inv.clients?.name || undefined,
          total_paid: totalPaid,
          pending: Math.max(0, Math.round((total - totalPaid) * 100) / 100),
        };
      }).filter((inv) => inv.pending > 0);
    } catch (err) {
      console.error('Error fetching payable invoices:', err);
      toast({
        title: 'Error al cargar facturas',
        description: err instanceof Error ? err.message : 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
      return [];
    }
  }, [activeBusinessId, toast]);

  return {
    payments,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    fetchPayments,
    createPayment,
    fetchPayableInvoices,
    deletePayment,
  };
}
