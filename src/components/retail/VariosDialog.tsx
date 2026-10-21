import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseVarios, variosCartItem, VARIOS_MAX_NAME } from '@/lib/varios';
import type { CartItem } from '@/hooks/useRetailSales';

/** Ventana «Varios»: añade al ticket una línea libre con descripción, precio y unidades. */
export function VariosDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: CartItem) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPrice('');
      setQuantity('1');
      setError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = parseVarios({ name, price, quantity });
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onAdd(variosCartItem(result));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Varios</DialogTitle>
          <DialogDescription>
            Para outlet o artículos que no están en el catálogo. No descuenta stock.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="varios-name">Descripción</Label>
            <Input
              id="varios-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={VARIOS_MAX_NAME}
              placeholder="Ej.: Bolso outlet"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="varios-price">Precio (IVA incluido)</Label>
              <Input
                id="varios-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="varios-qty">Unidades</Label>
              <Input
                id="varios-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">El descuento se pone en la línea, como en el resto.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Añadir</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
