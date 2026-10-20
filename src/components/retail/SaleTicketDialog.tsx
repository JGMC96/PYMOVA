import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Check, X, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CartItem } from '@/hooks/useRetailSales';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { printTicket, type TicketDoc } from '@/lib/ticket';
import { TicketPreview } from './TicketPreview';
import { SendReceiptDialog } from './SendReceiptDialog';

export interface TicketData {
  saleNumber: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  paymentMethod: string;
  createdAt: Date;
  /** Importe original por clave (variant_id ?? product_id) antes del descuento */
  originalTotals?: Record<string, number>;
  tip?: number;
  cashReceived?: number | null;
  change?: number | null;
  notes?: string | null;
  /** Dependiente que atendió, para «Atendido por». */
  cashier?: string | null;
  /** Venta registrada (para enviar el ticket por correo). */
  saleId?: string;
  clientName?: string | null;
  /** El cliente tiene correo y aceptó el ticket por correo. */
  clientCanEmail?: boolean;
}

interface SaleTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;
}

export function toTicketDoc(t: TicketData): TicketDoc {
  const tip = t.tip ?? 0;
  return {
    kind: 'sale',
    number: t.saleNumber,
    createdAt: t.createdAt,
    taxRate: t.taxRate,
    total: Math.round((t.total - tip) * 100) / 100,
    tip,
    paymentMethod: t.paymentMethod,
    cashReceived: t.cashReceived,
    change: t.change,
    notes: t.notes,
    cashier: t.cashier ?? null,
    clientName: t.clientName ?? null,
    lines: t.items.map((i) => {
      const key = i.variant_id ?? i.product_id;
      const orig = t.originalTotals?.[key] ?? i.total;
      return {
        name: i.product_name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        total: i.total,
        discount: Math.max(0, Math.round((orig - i.total) * 100) / 100),
      };
    }),
  };
}

export function SaleTicketDialog({ open, onOpenChange, ticket }: SaleTicketDialogProps) {
  const { business, prefs } = useTicketConfig();
  const doc = useMemo(() => (ticket ? toTicketDoc(ticket) : null), [ticket]);
  const printedFor = useRef<string | null>(null);
  const [sendFor, setSendFor] = useState<{ id: string; number: string } | null>(null);

  useEffect(() => {
    if (open && doc && prefs.autoPrint && printedFor.current !== doc.number) {
      printedFor.current = doc.number;
      printTicket(business, doc, prefs);
    }
  }, [open, doc, prefs, business]);

  if (!doc) return null;
  const sendSale = ticket?.saleId ? { id: ticket.saleId, number: doc.number } : null;

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

        <TicketPreview business={business} doc={doc} prefs={prefs} className="max-h-[60vh]" />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-2" />
            Cerrar
          </Button>
          {sendSale && (
            <Button variant={ticket?.clientCanEmail ? 'default' : 'outline'} onClick={() => setSendFor(sendSale)}>
              <Mail className="w-4 h-4 mr-2" />
              Enviar por correo
            </Button>
          )}
          <Button
            variant={ticket?.clientCanEmail ? 'outline' : 'default'}
            onClick={() => printTicket(business, doc, prefs)}
            autoFocus={!ticket?.clientCanEmail}
          >
            <Printer className="w-4 h-4 mr-2" />
            Imprimir ticket
          </Button>
        </DialogFooter>
      </DialogContent>
      <SendReceiptDialog sale={sendFor} onClose={() => setSendFor(null)} />
    </Dialog>
  );
}
