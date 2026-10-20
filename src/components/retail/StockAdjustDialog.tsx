import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStockAdjust } from '@/hooks/useStockAdjust';
import { buildAdjustReason, STOCK_ADJUST_REASONS } from '@/lib/stockAdjust';

export interface StockAdjustTarget {
  productId: string;
  variantId: string | null;
  name: string;
  current: number;
}

interface StockAdjustDialogProps {
  target: StockAdjustTarget | null;
  onClose: () => void;
  onDone?: () => void;
}

export function StockAdjustDialog({ target, onClose, onDone }: StockAdjustDialogProps) {
  const { adjust, isAdjusting } = useStockAdjust();
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<string>(STOCK_ADJUST_REASONS[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setQuantity(String(target.current));
    setReason(STOCK_ADJUST_REASONS[0]);
    setNote('');
    setError(null);
  }, [target]);

  const save = async () => {
    if (!target) return;
    const value = Number(quantity);
    if (!Number.isInteger(value) || value < 0) {
      setError('La cantidad debe ser un número entero, 0 o más');
      return;
    }
    const text = buildAdjustReason(reason, note);
    if (!text) {
      setError('Explica el motivo en la nota');
      return;
    }
    const ok = await adjust({ productId: target.productId, variantId: target.variantId, newQuantity: value, reason: text });
    if (ok) {
      onDone?.();
      onClose();
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar stock</DialogTitle>
          <DialogDescription>
            {target?.name}: stock actual {target?.current}. El ajuste queda en el historial con tu usuario y, si el
            artículo está en Shopify, se manda a la tienda.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sa-cantidad">Cantidad nueva</Label>
            <Input
              id="sa-cantidad"
              type="number"
              min={0}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_ADJUST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sa-nota">Nota {reason === 'Otro' ? '' : '(opcional)'}</Label>
            <Input id="sa-nota" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isAdjusting}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={isAdjusting}>
            {isAdjusting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
