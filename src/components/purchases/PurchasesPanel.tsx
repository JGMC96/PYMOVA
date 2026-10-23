import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackagePlus, Truck, Pencil, Ban, Send, Loader2, Tag } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { usePurchases, type PurchaseOrder } from '@/hooks/usePurchases';
import { PURCHASE_STATUS_LABELS, purchaseTotals } from '@/lib/compras';
import { PurchaseEditorDialog } from './PurchaseEditorDialog';
import { ReceivePurchaseDialog } from './ReceivePurchaseDialog';
import { LabelPrintDialog } from '@/components/labels/LabelPrintDialog';
import { useInventory } from '@/hooks/useInventory';
import { labelDataFor, type LabelData } from '@/lib/labels';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  ordered: 'secondary',
  partial: 'default',
  received: 'secondary',
  cancelled: 'destructive',
};

/** Compras a proveedor: lista, alta y edición, y recepción de la mercancía. */
export function PurchasesPanel() {
  const { fetchOrders, setStatus, isSaving } = usePurchases();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PurchaseOrder | null | 'new'>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  // Etiquetas de una compra: de todo lo recibido o solo de lo que acaba de llegar.
  const [labelsFor, setLabelsFor] = useState<{ order: PurchaseOrder; only?: Record<string, number> } | null>(null);
  const { products } = useInventory();

  // Etiquetas de una compra: una por par recibido, con los datos actuales del catálogo.
  const labelItems = useMemo(() => {
    if (!labelsFor) return [];
    const items: { data: LabelData; quantity: number }[] = [];
    for (const i of labelsFor.order.items) {
      const qty = labelsFor.only ? labelsFor.only[i.id] ?? 0 : i.qty_received;
      if (qty <= 0) continue;
      const product = products.find((p) => p.id === i.product_id);
      if (!product) continue;
      const variant = i.variant_id ? product.variants.find((v) => v.id === i.variant_id) ?? null : null;
      items.push({ data: labelDataFor(product, variant), quantity: qty });
    }
    return items;
  }, [labelsFor, products]);

  const reload = useCallback(async () => {
    setLoading(true);
    setOrders(await fetchOrders());
    setLoading(false);
  }, [fetchOrders]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = useMemo(() => orders.filter((o) => ['draft', 'ordered', 'partial'].includes(o.status)).length, [orders]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PackagePlus className="w-4 h-4 mr-2" />
          Nueva compra
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            Todavía no hay compras. Crea la primera con «Nueva compra».
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compra</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Recibidas</TableHead>
                <TableHead className="text-right">Coste</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const t = purchaseTotals(o.items);
                const editable = (o.status === 'draft' || o.status === 'ordered') && t.received === 0;
                const receivable = ['draft', 'ordered', 'partial'].includes(o.status);
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="font-medium">{o.number}</div>
                      <div className="text-xs text-muted-foreground">
                        {[o.season, new Date(o.created_at).toLocaleDateString('es-ES')].filter(Boolean).join(' · ')}
                      </div>
                    </TableCell>
                    <TableCell>{o.supplier_name ?? '—'}</TableCell>
                    <TableCell>{o.location_name ?? 'Tienda'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[o.status] ?? 'outline'}>{PURCHASE_STATUS_LABELS[o.status] ?? o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.received} / {t.ordered}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.cost.toFixed(2)} €</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {receivable && (
                          <Button size="sm" onClick={() => setReceiving(o)}>
                            <Truck className="w-4 h-4 mr-1.5" />
                            Recibir
                          </Button>
                        )}
                        {t.received > 0 && (
                          <Button size="sm" variant="outline" onClick={() => setLabelsFor({ order: o })} title="Imprimir etiquetas de lo recibido">
                            <Tag className="w-4 h-4" />
                          </Button>
                        )}
                        {editable && (
                          <Button size="sm" variant="outline" onClick={() => setEditing(o)} aria-label="Editar compra">
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {o.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSaving}
                            onClick={async () => {
                              if (await setStatus(o.id, 'ordered') !== null) void reload();
                            }}
                            title="Marcar como pedida"
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                        )}
                        {editable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={isSaving}
                            onClick={async () => {
                              if (!window.confirm(`¿Cancelar la compra ${o.number}?`)) return;
                              if (await setStatus(o.id, 'cancelled') !== null) void reload();
                            }}
                            title="Cancelar compra"
                          >
                            <Ban className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {open > 0 && <p className="text-xs text-muted-foreground">{open} compras abiertas.</p>}

      <PurchaseEditorDialog
        open={editing !== null}
        order={editing === 'new' ? null : editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
      <LabelPrintDialog
        open={labelsFor !== null}
        onOpenChange={(v) => !v && setLabelsFor(null)}
        title={labelsFor?.only ? `Etiquetas de lo recibido · ${labelsFor.order.number}` : `Etiquetas de ${labelsFor?.order.number ?? ''}`}
        items={labelItems}
      />
      <ReceivePurchaseDialog
        order={receiving}
        onClose={() => setReceiving(null)}
        onReceived={(received) => {
          const order = receiving;
          setReceiving(null);
          void reload();
          // Al momento, las etiquetas de lo que acaba de llegar.
          if (order) setLabelsFor({ order, only: received });
        }}
      />
    </div>
  );
}
