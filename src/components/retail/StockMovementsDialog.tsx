import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STOCK_SOURCE_LABEL, useStockMovements } from '@/hooks/useStockMovements';
import { cn } from '@/lib/utils';

interface StockMovementsDialogProps {
  product: { id: string; name: string } | null;
  onClose: () => void;
}

export function StockMovementsDialog({ product, onClose }: StockMovementsDialogProps) {
  const { movements, isLoading, error } = useStockMovements(product?.id ?? null);

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Movimientos de stock</DialogTitle>
          <DialogDescription>
            {product?.name}: últimos 50 cambios, con su origen. Las ventas online y la mercancía que entra en
            Shopify llegan como «Shopify».
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-6 text-center">No se pudieron cargar los movimientos: {error}</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Todavía no hay movimientos registrados.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Cambio</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{format(new Date(m.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                    <TableCell>{m.variant_name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" title={m.note ?? undefined}>
                        {STOCK_SOURCE_LABEL[m.source] ?? m.source}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn('text-right font-mono', m.delta < 0 ? 'text-destructive' : 'text-emerald-500')}
                    >
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </TableCell>
                    <TableCell className="text-right font-mono">{m.stock_after ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
