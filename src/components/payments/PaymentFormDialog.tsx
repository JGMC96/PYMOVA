import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { InvoiceForPayment, CreatePaymentData } from '@/types/database';
import { useMoney } from '@/hooks/useMoney';

const paymentSchema = z.object({
  invoice_id: z.string().min(1, 'Selecciona una factura'),
  amount: z.coerce.number().positive('El monto debe ser mayor a 0'),
  payment_method: z.string().optional(),
  payment_date: z.string().min(1, 'La fecha es requerida'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof paymentSchema>;

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'bank', label: 'Transferencia' },
  { value: 'other', label: 'Otro' },
];

interface PaymentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreatePaymentData) => Promise<boolean>;
  isSubmitting: boolean;
  invoices: InvoiceForPayment[];
  isLoadingInvoices: boolean;
}

export function PaymentFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  invoices,
  isLoadingInvoices,
}: PaymentFormDialogProps) {
  const { format: formatPrice } = useMoney();
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceForPayment | null>(null);
  const [showOverpayConfirm, setShowOverpayConfirm] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<FormValues | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoice_id: '',
      amount: 0,
      payment_method: '',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    },
  });

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset({
        invoice_id: '',
        amount: 0,
        payment_method: '',
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
      });
      setSelectedInvoice(null);
      setShowOverpayConfirm(false);
      setPendingSubmit(null);
    }
  }, [open, form]);

  // Watch invoice_id to update selected invoice info
  const watchedInvoiceId = form.watch('invoice_id');
  useEffect(() => {
    if (watchedInvoiceId) {
      const invoice = invoices.find((inv) => inv.id === watchedInvoiceId);
      setSelectedInvoice(invoice || null);
      // Auto-fill pending amount if this is the first selection
      if (invoice && form.getValues('amount') === 0) {
        form.setValue('amount', invoice.pending);
      }
    } else {
      setSelectedInvoice(null);
    }
  }, [watchedInvoiceId, invoices, form]);

  // Watch amount to detect overpay
  const watchedAmount = form.watch('amount');
  const isOverpay = selectedInvoice && watchedAmount > selectedInvoice.pending && selectedInvoice.pending > 0;

  const handleSubmit = async (values: FormValues) => {
    // Check for overpay and require confirmation
    if (selectedInvoice && values.amount > selectedInvoice.pending && selectedInvoice.pending > 0) {
      setPendingSubmit(values);
      setShowOverpayConfirm(true);
      return;
    }

    await executeSubmit(values);
  };

  const executeSubmit = async (values: FormValues) => {
    const success = await onSubmit({
      invoice_id: values.invoice_id,
      amount: values.amount,
      payment_method: values.payment_method || undefined,
      payment_date: values.payment_date,
      notes: values.notes || undefined,
    });

    if (success) {
      onOpenChange(false);
    }
  };

  const handleConfirmOverpay = async () => {
    if (pendingSubmit) {
      setShowOverpayConfirm(false);
      await executeSubmit(pendingSubmit);
      setPendingSubmit(null);
    }
  };

  const handleCancelOverpay = () => {
    setShowOverpayConfirm(false);
    setPendingSubmit(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nuevo pago</DialogTitle>
          <DialogDescription>
            Registra un pago para una factura existente
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="invoice_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Factura *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isLoadingInvoices}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoadingInvoices ? 'Cargando...' : 'Selecciona una factura'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {invoices.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          No hay facturas disponibles
                        </div>
                      ) : (
                        invoices.map((invoice) => (
                          <SelectItem key={invoice.id} value={invoice.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{invoice.invoice_number}</span>
                              {invoice.client_name && (
                                <span className="text-muted-foreground">
                                  - {invoice.client_name}
                                </span>
                              )}
                              <Badge 
                                variant={invoice.status === 'paid' ? 'default' : invoice.status === 'overdue' ? 'destructive' : 'secondary'}
                                className="ml-auto text-xs"
                              >
                                {invoice.status === 'paid' ? 'Pagada' : invoice.status === 'overdue' ? 'Vencida' : 'Enviada'}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Invoice info card */}
            {selectedInvoice && (
              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total factura:</span>
                  <span className="font-medium">{formatPrice(selectedInvoice.total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Ya pagado:</span>
                  <span className="font-medium text-green-600">
                    {formatPrice(selectedInvoice.total_paid)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Pendiente:</span>
                  <span className="font-bold text-orange-600">
                    {formatPrice(selectedInvoice.pending)}
                  </span>
                </div>
              </div>
            )}

            {/* Overpay warning */}
            {isOverpay && !showOverpayConfirm && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Monto excede el pendiente</AlertTitle>
                <AlertDescription>
                  El monto ingresado ({formatPrice(watchedAmount)}) supera el pendiente 
                  ({formatPrice(selectedInvoice?.pending || 0)}). Se te pedirá confirmación al guardar.
                </AlertDescription>
              </Alert>
            )}

            {/* Overpay confirmation dialog */}
            {showOverpayConfirm && (
              <Alert variant="destructive" className="border-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>¿Confirmar sobrepago?</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    Estás registrando {formatPrice(pendingSubmit?.amount || 0)} cuando solo 
                    quedan pendientes {formatPrice(selectedInvoice?.pending || 0)}.
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      type="button" 
                      variant="destructive" 
                      size="sm"
                      onClick={handleConfirmOverpay}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Guardando...' : 'Confirmar sobrepago'}
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={handleCancelOverpay}
                      disabled={isSubmitting}
                    >
                      Cancelar
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="payment_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Método de pago</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un método" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="payment_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha del pago *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Notas adicionales sobre el pago..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || showOverpayConfirm}>
                {isSubmitting ? 'Guardando...' : 'Registrar pago'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
