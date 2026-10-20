import { useEffect, useRef, useState } from 'react';
import { Loader2, Printer, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSaleReturns } from '@/hooks/useSaleReturns';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { printTicket, type TicketDoc } from '@/lib/ticket';
import { TicketPreview } from './TicketPreview';

interface RefundTicketDialogProps {
  /** Devolución a mostrar; null cierra el diálogo. */
  returnId: string | null;
  onClose: () => void;
  /** Recién registrada: se imprime sola si el terminal lo tiene activado. */
  justCreated?: boolean;
}

/** Ticket de abono de una devolución: tras registrarla y para reimprimirla desde el historial. */
export function RefundTicketDialog({ returnId, onClose, justCreated }: RefundTicketDialogProps) {
  const { business, prefs, taxRate } = useTicketConfig();
  const { fetchRefundTicket } = useSaleReturns();
  const [doc, setDoc] = useState<TicketDoc | null>(null);
  const printedFor = useRef<string | null>(null);

  useEffect(() => {
    setDoc(null);
    if (!returnId) return;
    void fetchRefundTicket(returnId, taxRate).then(setDoc);
  }, [returnId, taxRate, fetchRefundTicket]);

  useEffect(() => {
    if (justCreated && doc && prefs.autoPrint && printedFor.current !== doc.number) {
      printedFor.current = doc.number;
      printTicket(business, doc, prefs);
    }
  }, [justCreated, doc, prefs, business]);

  return (
    <Dialog open={!!returnId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            {justCreated ? 'Devolución registrada' : `Devolución ${doc?.number ?? ''}`}
          </DialogTitle>
        </DialogHeader>

        {doc ? (
          <TicketPreview business={business} doc={doc} prefs={prefs} className="max-h-[60vh]" />
        ) : (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Cerrar
          </Button>
          <Button onClick={() => doc && printTicket(business, doc, prefs)} disabled={!doc} autoFocus>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir abono
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
