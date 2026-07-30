import { useEffect, useState } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSaleReturns, type SaleDetailLine } from '@/hooks/useSaleReturns';

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string | null;
  saleNumber?: string;
  onCompleted?: () => void;
}

export function ReturnDialog({ open, onOpenChange, saleId, saleNumber, onCompleted }: ReturnDialogProps) {
  const { fetchSaleDetail, createReturn, isLoading, isSubmitting } = useSaleReturns();
  const [lines, setLines] = useState<SaleDetailLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [restock, setRestock] = useState(true);

  useEffect(() => {
    if (!open || !saleId) return;
    setReason('');
    setRefundMethod('cash');
    setRestock(true);
    setQuantities({});
    fetchSaleDetail(saleId).then(setLines);
  }, [open, saleId, fetchSaleDetail]);

  const remaining = (line: SaleDetailLine) => Number(line.quantity) - Number(line.returned_quantity);

  const totalRefund = lines.reduce(
    (sum, line) => sum + (quantities[line.sale_item_id] || 0) * Number(line.unit_price),
    0
  );

  const handleSubmit = async () => {
    if (!saleId) return;
    const items = lines
      .map((line) => ({ sale_item_id: line.sale_item_id, quantity: quantities[line.sale_item_id] || 0 }))
      .filter((i) => i.quantity > 0);

    const result = await createReturn({ saleId, items, reason, refundMethod, restock });
    if (result) {
      onOpenChange(false);
      onCompleted?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Devolución {saleNumber ? `· ${saleNumber}` : ''}
          </DialogTitle>
          <DialogDescription>
            Indica las unidades a devolver. Si repones inventario, el stock se sumará de nuevo automáticamente.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {lines.map((line) => {
                const max = remaining(line);
                return (
                  <div
                    key={line.sale_item_id}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{line.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {Number(line.quantity)} vendidas · {Number(line.returned_quantity)} devueltas ·{' '}
                        {Number(line.unit_price).toFixed(2)} €/ud
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={max}
                      step={1}
                      disabled={max <= 0}
                      className="w-24"
                      value={quantities[line.sale_item_id] ?? ''}
                      placeholder="0"
                      onChange={(e) => {
                        const value = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                        setQuantities((prev) => ({ ...prev, [line.sale_item_id]: value }));
                      }}
                    />
                  </div>
                );
              })}
              {lines.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Esta venta no tiene líneas.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refund-method">Reembolso</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger id="refund-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="store_credit">Vale de tienda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
                  Reponer al inventario
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="return-reason">Motivo (opcional)</Label>
              <Textarea
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Talla incorrecta, producto defectuoso..."
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <span className="text-sm text-muted-foreground">Total a reembolsar</span>
              <span className="text-lg font-semibold">{totalRefund.toFixed(2)} €</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || totalRefund <= 0}>
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Registrar devolución
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
