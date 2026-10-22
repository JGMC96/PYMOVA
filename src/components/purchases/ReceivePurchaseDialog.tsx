import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { usePurchases, type PurchaseOrder } from '@/hooks/usePurchases';
import { pendingOf, receiptLines, scanForReceipt } from '@/lib/compras';
import { toast } from 'sonner';

/** Recepción de una compra: se escanea cada par (o se escribe la cantidad) y se confirma. */
export function ReceivePurchaseDialog({
  order,
  onClose,
  onReceived,
}: {
  order: PurchaseOrder | null;
  onClose: () => void;
  /** Lo recibido ahora (línea → unidades), para ofrecer sus etiquetas. */
  onReceived: (received: Record<string, number>) => void;
}) {
  const { receive, isSaving } = usePurchases();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [code, setCode] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCounts({});
    setCode('');
    setLast(null);
  }, [order]);

  if (!order) return null;
  const items = order.items;
  const lines = receiptLines(items, counts);
  const now = lines.reduce((s, l) => s + l.quantity, 0);
  const pending = items.reduce((s, i) => s + pendingOf(i), 0);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    const result = scanForReceipt(items, counts, code);
    if ('error' in result) {
      toast.error(result.error);
      setLast(null);
    } else {
      setCounts(result.counts);
      setLast(result.name);
    }
    setCode('');
    scanRef.current?.focus();
  };

  const handleConfirm = async () => {
    if (lines.length === 0) return;
    const receiptId = await receive(order.id, lines);
    if (receiptId) onReceived(Object.fromEntries(lines.map((l) => [l.item_id, l.quantity])));
  };

  return (
    <Dialog open={!!order} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recibir {order.number}</DialogTitle>
          <DialogDescription>
            Destino: {order.location_name ?? 'Tienda'}. Escanea cada par o escribe las unidades que han llegado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleScan} className="relative">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
          <Input
            ref={scanRef}
            className="pl-9 h-11"
            placeholder="Escanear código"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </form>
        {last && <p className="text-sm text-muted-foreground" aria-live="polite">Último: {last}</p>}

        <div className="divide-y rounded-lg border">
          {items.map((i) => {
            const left = pendingOf(i);
            return (
              <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{i.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.qty_received} de {i.qty_ordered} recibidas{i.barcode ? ` · ${i.barcode}` : ''}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={left}
                  disabled={left === 0}
                  className="w-20 text-center"
                  aria-label={`Unidades de ${i.product_name}`}
                  value={counts[i.id] ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(left, Math.floor(Number(e.target.value) || 0)));
                    setCounts((prev) => ({ ...prev, [i.id]: v }));
                  }}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => setCounts(Object.fromEntries(items.map((i) => [i.id, pendingOf(i)])))}
            disabled={pending === 0}
          >
            Ha llegado todo lo pendiente ({pending})
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cerrar</Button>
            <Button onClick={() => void handleConfirm()} disabled={isSaving || now === 0}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Recibir {now} {now === 1 ? 'unidad' : 'unidades'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
