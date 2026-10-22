import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { matchesSearch } from '@/lib/search';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useInventory, type ProductWithStock } from '@/hooks/useInventory';
import {
  usePurchases, type PurchaseDraftLine, type PurchaseOrder, type StockLocation, type Supplier,
} from '@/hooks/usePurchases';
import { netUnitCost } from '@/lib/compras';

/** Un producto en la compra: cantidades por talla (variante) y un coste y descuento comunes. */
interface ProductBlock {
  productId: string;
  name: string;
  /** Sin variantes: una sola cantidad con la clave del producto. */
  sizes: { key: string; label: string; variantId: string | null }[];
  quantities: Record<string, string>;
  unitCost: string;
  discount: string;
}

const NEW_SUPPLIER = '__new__';
const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

function blockFor(p: ProductWithStock): ProductBlock {
  const variants = p.variants.filter((v) => v.is_active);
  const cost = variants.find((v) => v.cost_price != null)?.cost_price ?? null;
  return {
    productId: p.id,
    name: p.name,
    sizes: variants.length
      ? variants.map((v) => ({ key: v.id, label: v.name, variantId: v.id }))
      : [{ key: p.id, label: 'Unidades', variantId: null }],
    quantities: {},
    unitCost: cost != null ? String(cost).replace('.', ',') : '',
    discount: '',
  };
}

/** Alta y edición de una compra (solo mientras no se haya recibido nada). */
export function PurchaseEditorDialog({
  open,
  order,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  order: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { products } = useInventory();
  const { fetchSuppliers, fetchLocations, saveSupplier, saveOrder, isSaving } = usePurchases();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [supplierId, setSupplierId] = useState<string>('');
  const [newSupplier, setNewSupplier] = useState('');
  const [locationGid, setLocationGid] = useState<string>('');
  const [season, setSeason] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ProductBlock[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    void fetchSuppliers().then(setSuppliers);
    void fetchLocations().then((locs) => {
      setLocations(locs);
      if (!order) setLocationGid(locs.find((l) => l.is_default)?.location_gid ?? locs[0]?.location_gid ?? '');
    });
    setSupplierId(order?.supplier_id ?? '');
    setNewSupplier('');
    setLocationGid(order?.location_gid ?? '');
    setSeason(order?.season ?? '');
    setExpectedAt(order?.expected_at ?? '');
    setNotes(order?.notes ?? '');
    setQuery('');
    setBlocks([]);
  }, [open, order, fetchSuppliers, fetchLocations]);

  // Al editar, las líneas guardadas se agrupan por producto.
  useEffect(() => {
    if (!open || !order || products.length === 0) return;
    const byProduct = new Map<string, ProductBlock>();
    for (const item of order.items) {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) continue;
      const block = byProduct.get(product.id) ?? blockFor(product);
      block.quantities[item.variant_id ?? product.id] = String(item.qty_ordered);
      block.unitCost = String(item.unit_cost).replace('.', ',');
      block.discount = item.discount_pct ? String(item.discount_pct).replace('.', ',') : '';
      byProduct.set(product.id, block);
    }
    setBlocks([...byProduct.values()]);
  }, [open, order, products]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => !blocks.some((b) => b.productId === p.id))
      .filter(
        (p) =>
          matchesSearch(q, [p.name, p.sku]) ||
          p.barcode?.toLowerCase() === q ||
          p.variants.some((v) => v.barcode?.toLowerCase() === q || v.sku?.toLowerCase() === q),
      )
      .slice(0, 8);
  }, [products, query, blocks]);

  const lines: PurchaseDraftLine[] = blocks.flatMap((b) =>
    b.sizes
      .map((s) => ({
        variant_id: s.variantId,
        product_id: s.variantId ? null : b.productId,
        quantity: Math.floor(num(b.quantities[s.key] ?? '')),
        unit_cost: num(b.unitCost),
        discount_pct: num(b.discount),
      }))
      .filter((l) => l.quantity > 0),
  );
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.quantity * netUnitCost(l.unit_cost, l.discount_pct), 0);

  const update = (productId: string, patch: Partial<ProductBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.productId === productId ? { ...b, ...patch } : b)));

  const handleSave = async () => {
    let supplier: string | null = supplierId && supplierId !== NEW_SUPPLIER ? supplierId : null;
    if (supplierId === NEW_SUPPLIER) {
      if (!newSupplier.trim()) return;
      supplier = await saveSupplier(newSupplier.trim());
      if (!supplier) return;
    }
    const saved = await saveOrder({
      id: order?.id ?? null,
      supplier_id: supplier,
      location_gid: locationGid || null,
      season,
      expected_at: expectedAt || null,
      notes,
      lines,
    });
    if (saved) onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `Editar compra ${order.number}` : 'Nueva compra'}</DialogTitle>
          <DialogDescription>Añade los productos y las unidades de cada talla. El coste es por unidad, sin IVA.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Proveedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Elige proveedor" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                <SelectItem value={NEW_SUPPLIER}>+ Nuevo proveedor</SelectItem>
              </SelectContent>
            </Select>
            {supplierId === NEW_SUPPLIER && (
              <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Nombre del proveedor" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Destino</Label>
            <Select value={locationGid} onValueChange={setLocationGid}>
              <SelectTrigger><SelectValue placeholder="Ubicación" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.location_gid} value={l.location_gid}>{l.location_name ?? l.location_gid}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purchase-season">Temporada</Label>
            <Input id="purchase-season" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="Ej.: FW26" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purchase-date">Llegada prevista</Label>
            <Input id="purchase-date" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Añadir producto: busca por nombre, SKU o código de barras"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
              {results.map((p) => (
                <button
                  key={p.id}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/60"
                  onClick={() => {
                    setBlocks((prev) => [...prev, blockFor(p)]);
                    setQuery('');
                  }}
                >
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    {p.variants.length ? `${p.variants.length} tallas` : 'Añadir'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Busca un producto para añadirlo a la compra.</p>
          )}
          {blocks.map((b) => (
            <div key={b.productId} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium truncate">{b.name}</p>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Coste €</Label>
                    <Input className="h-8 w-24" inputMode="decimal" value={b.unitCost} onChange={(e) => update(b.productId, { unitCost: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Dto. %</Label>
                    <Input className="h-8 w-16" inputMode="decimal" value={b.discount} onChange={(e) => update(b.productId, { discount: e.target.value })} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Quitar ${b.name}`}
                    onClick={() => setBlocks((prev) => prev.filter((x) => x.productId !== b.productId))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.sizes.map((s) => (
                  <div key={s.key} className="w-16 space-y-1">
                    <Label className="text-xs text-muted-foreground block text-center truncate" title={s.label}>{s.label}</Label>
                    <Input
                      className="h-8 text-center"
                      inputMode="numeric"
                      value={b.quantities[s.key] ?? ''}
                      placeholder="0"
                      onChange={(e) => update(b.productId, { quantities: { ...b.quantities, [s.key]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="purchase-notes">Notas</Label>
          <Textarea id="purchase-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {units} unidades · {total.toFixed(2)} € de coste
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => void handleSave()} disabled={isSaving || units === 0}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar compra
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
