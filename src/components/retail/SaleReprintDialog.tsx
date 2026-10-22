import { useEffect, useState } from 'react';
import { Loader2, Printer, Receipt, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { saleTicketDoc, type StoredSaleRow } from '@/lib/saleTicket';
import { printTicket, type TicketDoc } from '@/lib/ticket';
import { TicketPreview } from './TicketPreview';

/** Reimprimir el ticket de una venta del historial. */
export function SaleReprintDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { business, prefs, taxRate } = useTicketConfig();
  const [doc, setDoc] = useState<TicketDoc | null>(null);

  useEffect(() => {
    setDoc(null);
    if (!saleId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('sale_number, created_at, payment_method, total, tip, cash_received, change_given, notes, voucher_amount, seller_employee_id, clients(name), store_vouchers!sales_voucher_id_fkey(code), sale_items(product_name, quantity, unit_price, total)')
        .eq('id', saleId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error('No se pudo cargar el ticket de la venta');
        onClose();
        return;
      }
      const row = data as unknown as StoredSaleRow & { seller_employee_id: string | null };
      let cashier: string | null = null;
      if (row.seller_employee_id) {
        const { data: name } = await supabase.rpc('employee_display_name' as never, { _employee_id: row.seller_employee_id } as never);
        cashier = typeof name === 'string' ? name : null;
      }
      if (!cancelled) setDoc(saleTicketDoc(row, taxRate, cashier));
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId, taxRate, onClose]);

  return (
    <Dialog open={!!saleId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Ticket {doc?.number ?? ''}
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
            Imprimir ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
