import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { MoreHorizontal, Send, CheckCircle, XCircle, FileText } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { InvoiceStatus } from '@/types/database';
import type { InvoiceWithClient } from '@/hooks/useInvoices';
import { useMoney } from '@/hooks/useMoney';

interface InvoicesTableProps {
  invoices: InvoiceWithClient[];
  isLoading: boolean;
  onStatusChange: (id: string, status: InvoiceStatus) => void;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Borrador', variant: 'secondary' },
  sent: { label: 'Enviada', variant: 'default' },
  paid: { label: 'Pagada', variant: 'default' },
  overdue: { label: 'Vencida', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'outline' },
};

export function InvoicesTable({ invoices, isLoading, onStatusChange }: InvoicesTableProps) {
  // 0031: cambiar el estado de una factura, solo administradores.
  const { isAdmin } = useRoleAccess('admin');
  const { format: formatPrice } = useMoney();
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-1">No hay facturas</h3>
        <p className="text-muted-foreground">
          Crea tu primera factura para empezar
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Número</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Vencimiento</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const statusConfig = STATUS_CONFIG[invoice.status];
            const canMarkAsSent = invoice.status === 'draft';
            const canMarkAsPaid = invoice.status === 'sent' || invoice.status === 'overdue';
            const canCancel = invoice.status === 'draft' || invoice.status === 'sent';

            return (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                <TableCell>{invoice.client_name || '-'}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatPrice(invoice.total)}
                </TableCell>
                <TableCell>
                  <Badge 
                    variant={statusConfig.variant}
                    className={invoice.status === 'paid' ? 'bg-green-500 hover:bg-green-600 text-white' : ''}
                  >
                    {statusConfig.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {format(new Date(invoice.created_at), 'dd MMM yyyy', { locale: es })}
                </TableCell>
                <TableCell>
                  {invoice.due_date
                    ? format(new Date(invoice.due_date), 'dd MMM yyyy', { locale: es })
                    : '-'}
                </TableCell>
                <TableCell>
                  {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canMarkAsSent && (
                        <DropdownMenuItem onClick={() => onStatusChange(invoice.id, 'sent')}>
                          <Send className="h-4 w-4 mr-2" />
                          Marcar como Enviada
                        </DropdownMenuItem>
                      )}
                      {canMarkAsPaid && (
                        <DropdownMenuItem onClick={() => onStatusChange(invoice.id, 'paid')}>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Marcar como Pagada
                        </DropdownMenuItem>
                      )}
                      {(canMarkAsSent || canMarkAsPaid) && canCancel && (
                        <DropdownMenuSeparator />
                      )}
                      {canCancel && (
                        <DropdownMenuItem
                          onClick={() => onStatusChange(invoice.id, 'cancelled')}
                          className="text-destructive focus:text-destructive"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Cancelar Factura
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
