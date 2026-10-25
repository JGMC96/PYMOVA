import { useEffect, useState } from 'react';
import { Loader2, Printer, Receipt, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { stockagileTicketDoc, type StoredStockagileSaleRow } from '@/lib/saleTicket';
import { printTicket, type TicketDoc } from '@/lib/ticket';
import { TicketPreview } from './TicketPreview';

/** Duplicado de un ticket de Stockagile (copia de la 0046), para reimprimirlo desde Historial. */
export function StockagileReprintDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { activeBusinessId } = useBusiness();
  const { business, prefs, taxRate } = useTicketConfig();
  const [doc, setDoc] = useState<TicketDoc | null>(null);

  useEffect(() => {
    setDoc(null);
    if (!saleId || !activeBusinessId) return;
    let cancelled = false;
    void (async () => {
      // Tablas de la 0046: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase
        .from('stockagile_sales' as never)
        .select('number, sold_at, total, is_return, return_of_external_id, payment_methods, customer_name, clients(name), stockagile_sale_items(product_name, quantity, unit_price, total)')
        .eq('id', saleId)
        .eq('business_id', activeBusinessId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error('No se pudo cargar el ticket de Stockagile');
        onClose();
        return;
      }
      const row = data as unknown as StoredStockagileSaleRow & { return_of_external_id: number | null };
      // Una devolución o un cambio dice qué ticket rectifica.
      let original: string | null = null;
      if (row.is_return && row.return_of_external_id != null) {
        const { data: orig } = await supabase
          .from('stockagile_sales' as never)
          .select('number')
          .eq('business_id', activeBusinessId)
          .eq('external_id', row.return_of_external_id)
          .maybeSingle();
        original = (orig as { number: string | null } | null)?.number ?? null;
      }
      if (!cancelled) setDoc(stockagileTicketDoc(row, taxRate, original));
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId, activeBusinessId, taxRate, onClose]);

  return (
    <Dialog open={!!saleId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Duplicado {doc?.number ?? ''}
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
            Imprimir duplicado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
