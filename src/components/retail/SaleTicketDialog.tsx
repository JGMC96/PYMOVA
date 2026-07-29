import { useRef } from 'react';
import { Printer, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBusiness } from '@/contexts/BusinessContext';
import type { CartItem } from '@/hooks/useRetailSales';

export interface TicketData {
  saleNumber: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  paymentMethod: string;
  createdAt: Date;
}

interface SaleTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;
}

const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export function SaleTicketDialog({ open, onOpenChange, ticket }: SaleTicketDialogProps) {
  const { activeBusiness } = useBusiness();
  const printRef = useRef<HTMLDivElement>(null);

  if (!ticket) return null;

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket ${ticket.saleNumber}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              font-size: 12px;
              margin: 0;
              padding: 16px;
              color: #000;
              background: #fff;
            }
            .ticket { max-width: 280px; margin: 0 auto; }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            .lg { font-size: 14px; }
            .xl { font-size: 16px; }
            hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 2px 0; vertical-align: top; }
            .row { display: flex; justify-content: space-between; padding: 2px 0; }
            @media print {
              body { padding: 0; }
              @page { margin: 8mm; }
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            ${content.innerHTML}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 300);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const formatDate = (d: Date) =>
    d.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="w-5 h-5 text-primary" />
            </div>
            Venta registrada
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div ref={printRef} className="font-mono text-sm space-y-2">
            <div className="center text-center">
              <p className="bold xl font-bold text-base">
                {activeBusiness?.trade_name || activeBusiness?.name || 'Mi Negocio'}
              </p>
              {activeBusiness?.legal_name && (
                <p className="text-xs text-muted-foreground">{activeBusiness.legal_name}</p>
              )}
              {activeBusiness?.tax_id && (
                <p className="text-xs text-muted-foreground">CIF: {activeBusiness.tax_id}</p>
              )}
              <p className="text-xs text-muted-foreground">Ticket de venta</p>
            </div>


            <hr className="border-dashed border-border" />

            <div className="row flex justify-between text-xs">
              <span>No. Venta:</span>
              <span className="bold font-bold">{ticket.saleNumber}</span>
            </div>
            <div className="row flex justify-between text-xs">
              <span>Fecha:</span>
              <span>{formatDate(ticket.createdAt)}</span>
            </div>
            <div className="row flex justify-between text-xs">
              <span>Pago:</span>
              <span>{paymentLabels[ticket.paymentMethod] || ticket.paymentMethod}</span>
            </div>

            <hr className="border-dashed border-border" />

            <table className="w-full text-xs">
              <tbody>
                {ticket.items.map((item) => (
                  <tr key={item.product_id}>
                    <td colSpan={2} className="pt-1">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{item.product_name}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>
                          {item.quantity} x ${item.unit_price.toFixed(2)}
                        </span>
                        <span className="right text-right">${item.total.toFixed(2)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <hr className="border-dashed border-border" />

            <div className="row flex justify-between text-xs">
              <span>Subtotal:</span>
              <span>${ticket.subtotal.toFixed(2)}</span>
            </div>
            <div className="row flex justify-between text-xs">
              <span>IVA ({ticket.taxRate}%):</span>
              <span>${ticket.tax.toFixed(2)}</span>
            </div>

            <Separator className="my-2" />

            <div className="row flex justify-between bold lg font-bold text-base">
              <span>TOTAL:</span>
              <span>${ticket.total.toFixed(2)}</span>
            </div>

            <hr className="border-dashed border-border" />

            <p className="center text-center text-xs text-muted-foreground pt-2">
              ¡Gracias por su compra!
            </p>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-2" />
            Cerrar
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
