import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackagePlus, Truck, Pencil, Ban, Send, Loader2 } from 'lucide-react';
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Compras</h2>
          <p className="text-sm text-muted-foreground">
            Pedidos a proveedor y recepción de la mercancía. Al recibir, el stock sube en la ubicación de la compra.
          </p>
        </div>
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
      <ReceivePurchaseDialog
        order={receiving}
        onClose={() => setReceiving(null)}
        onReceived={() => {
          setReceiving(null);
          void reload();
        }}
      />
    </div>
  );
}
