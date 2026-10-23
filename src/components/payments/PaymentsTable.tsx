import { CreditCard, Undo2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PaymentWithInvoice } from '@/types/database';
import { useMoney } from '@/hooks/useMoney';

interface PaymentsTableProps {
  payments: PaymentWithInvoice[];
  isLoading: boolean;
  onNewPayment: () => void;
  onDeletePayment: (payment: PaymentWithInvoice) => void;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank: 'Transferencia',
  other: 'Otro',
};

function LoadingSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function EmptyState({ onNewPayment }: { onNewPayment: () => void }) {
  const { isAdmin } = useRoleAccess('admin');
  return (
    <TableRow>
      <TableCell colSpan={6} className="h-48">
        <div className="flex flex-col items-center justify-center text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No hay pagos registrados</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Registra tu primer pago contra una factura existente.
          </p>
          {isAdmin && (
            <Button onClick={onNewPayment} size="sm">
              Registrar pago
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function PaymentsTable({
  payments,
  isLoading,
  onNewPayment,
  onDeletePayment,
}: PaymentsTableProps) {
  const { format: formatPrice } = useMoney();
  const { isAdmin } = useRoleAccess('admin');
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Factura</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead>Método</TableHead>
            <TableHead>Notas</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <LoadingSkeleton />
          ) : payments.length === 0 ? (
            <EmptyState onNewPayment={onNewPayment} />
          ) : (
            payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="font-medium">
                  {format(new Date(payment.payment_date), 'dd MMM yyyy', { locale: es })}
                </TableCell>
                <TableCell>
                  {payment.invoice_number ? (
                    <span className="font-mono text-sm">{payment.invoice_number}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="font-medium text-green-600">
                  {formatPrice(Number(payment.amount))}
                </TableCell>
                <TableCell>
                  {payment.payment_method ? (
                    <Badge variant="outline">
                      {PAYMENT_METHOD_LABELS[payment.payment_method] || payment.payment_method}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">
                  {payment.notes || '-'}
                </TableCell>
                <TableCell>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Anular cobro"
                      aria-label="Anular cobro"
                      onClick={() => onDeletePayment(payment)}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
