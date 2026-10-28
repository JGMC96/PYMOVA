import { useState } from 'react';
import { Plus, Trash2, Layers, Edit2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useProductVariants } from '@/hooks/useProductVariants';
import { useStoreProfile } from '@/hooks/useStoreProfile';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { StockAdjustDialog, type StockAdjustTarget } from './StockAdjustDialog';
import { useCanAdjustStock } from '@/hooks/useStockAdjust';

interface VariantsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  basePrice: number;
  onChanged?: () => void;
}

export function VariantsDialog({
  open, onOpenChange, productId, productName, basePrice, onChanged,
}: VariantsDialogProps) {
  // 0031: dar de alta o de baja tallas, con permiso de catálogo; costes y stock, con los suyos.
  const { canEditCatalog, canSeeCosts } = useMyPermissions();
  const canAdjustStock = useCanAdjustStock();
  const { variants, isLoading, isSaving, createVariant, deleteVariant, refreshVariants } =
    useProductVariants(productId, { withCosts: canSeeCosts });
  const { profile } = useStoreProfile();
  const { isAdmin } = useRoleAccess('admin');
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);

  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('0');

  const handleCreate = async () => {
    if (!name.trim()) return;
    const ok = await createVariant(productId, {
      name: name.trim(),
      barcode: barcode.trim() || null,
      price: price ? parseFloat(price) : null,
      cost_price: cost ? parseFloat(cost) : null,
      // El stock inicial solo lo pone un admin; el resto, con un ajuste.
      stock_quantity: isAdmin ? parseInt(stock, 10) || 0 : 0,
    });
    if (ok) {
      setName('');
      setBarcode('');
      setPrice('');
      setCost('');
      setStock('0');
      onChanged?.();
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteVariant(id);
    if (ok) onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Variantes · {productName}
          </DialogTitle>
          <DialogDescription>
            {profile.variantAttributes.map((a) => a.label).join(' · ')} — cada variante tiene su
            propio stock y código de barras.
          </DialogDescription>
        </DialogHeader>

        {profile.variantAttributes.some((a) => a.suggestions.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {profile.variantAttributes.flatMap((attr) =>
              attr.suggestions.map((s) => (
                <Badge
                  key={`${attr.key}-${s}`}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => setName((prev) => (prev ? `${prev} / ${s}` : s))}
                >
                  {s}
                </Badge>
              ))
            )}
          </div>
        )}

        {canEditCatalog && (
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <div className="sm:col-span-2">
            <Label className="text-xs">Nombre</Label>
            <Input
              placeholder="Ej. Talla 42 / Negro"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Código</Label>
            <Input placeholder="EAN" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Precio</Label>
            <Input
              type="number"
              step="0.01"
              placeholder={basePrice.toFixed(2)}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          {canSeeCosts && (
          <div>
            <Label className="text-xs">Coste</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          )}
          <div className="flex gap-2">
            {isAdmin && (
              <div className="flex-1">
                <Label className="text-xs">Stock inicial</Label>
                <Input
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                />
              </div>
            )}
            <Button onClick={handleCreate} disabled={isSaving || !name.trim()} size="icon">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
        )}

        <Separator />

        {isLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin w-5 h-5 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : variants.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-6">
            Este producto todavía no tiene variantes
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variante</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                {canSeeCosts && <TableHead className="text-right">Coste</TableHead>}
                <TableHead className="text-center">Stock</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{v.barcode ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {(v.price ?? basePrice).toFixed(2)} €
                  </TableCell>
                  {canSeeCosts && (
                    <TableCell className="text-right text-muted-foreground">
                      {v.cost_price != null ? `${v.cost_price.toFixed(2)} €` : '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Badge variant={v.stock_quantity > 0 ? 'secondary' : 'destructive'}>
                        {v.stock_quantity}
                      </Badge>
                      {canAdjustStock && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Ajustar stock"
                          onClick={() =>
                            setAdjustTarget({
                              productId,
                              name: `${productName} · ${v.name}`,
                              rows: [{ variantId: v.id, name: v.name, current: v.stock_quantity }],
                            })
                          }
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEditCatalog && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(v.id)}
                        disabled={isSaving}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <StockAdjustDialog
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={() => {
            refreshVariants();
            onChanged?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
