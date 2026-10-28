// Inventario: historial de movimientos de stock a la derecha. Qué artículo, cuánto, cuánto
// queda, de dónde viene (venta, devolución, Shopify, ajuste, compra…), el motivo, quién y cuándo.
// Al elegir un producto en la tabla se filtra por él.
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { History, Loader2, RefreshCw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STOCK_SOURCE_LABEL, useStockMovements, type StockMovementSource } from '@/hooks/useStockMovements';
import { cn } from '@/lib/utils';

const FILTERS: { label: string; source: StockMovementSource | null }[] = [
  { label: 'Todo', source: null },
  { label: 'Ajustes', source: 'manual' },
  { label: 'Ventas', source: 'sale' },
  { label: 'Devoluciones', source: 'return' },
  { label: 'Compras', source: 'purchase' },
  { label: 'Shopify', source: 'shopify' },
];

interface StockHistoryPanelProps {
  product: { id: string; name: string } | null;
  source: StockMovementSource | null;
  onSourceChange: (source: StockMovementSource | null) => void;
  onClearProduct: () => void;
  /** Cambia tras cada ajuste para volver a cargar. */
  refreshKey: number;
  className?: string;
}

export function StockHistoryPanel({ product, source, onSourceChange, onClearProduct, refreshKey, className }: StockHistoryPanelProps) {
  const { movements, isLoading, error, refresh } = useStockMovements(product?.id ?? null, source, { reloadKey: refreshKey });

  return (
    <Card className={cn('flex flex-col xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]', className)}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Historial de movimientos
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refresh()} aria-label="Actualizar el historial">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        {product && (
          <Badge variant="secondary" className="w-fit gap-1 py-1 pl-2.5 pr-1 font-normal">
            {product.name}
            <button type="button" className="rounded p-0.5 hover:bg-background" onClick={onClearProduct} aria-label="Ver todos los productos">
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Badge
              key={f.label}
              variant={source === f.source ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => onSourceChange(f.source)}
            >
              {f.label}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : movements.length === 0 && !isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos.</p>
        ) : (
          <ul className="divide-y">
            {movements.map((m) => (
              <li key={m.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {product ? (m.variant_name ?? m.product_name) : [m.product_name, m.variant_name].filter(Boolean).join(' · ')}
                  </p>
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', m.delta > 0 ? 'text-primary' : 'text-destructive')}>
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                    {m.stock_after != null && <span className="font-normal text-muted-foreground"> → {m.stock_after}</span>}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {STOCK_SOURCE_LABEL[m.source] ?? m.source}
                  {m.who ? ` · ${m.who}` : ''} · {format(new Date(m.created_at), "d MMM, HH:mm", { locale: es })}
                </p>
                {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
