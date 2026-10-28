// Ajuste manual de stock: una talla, un producto sin tallas o todas las tallas de un producto
// en una rejilla. Un motivo y una nota para todo, y se guarda de una vez (todo o nada).
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { cn } from '@/lib/utils';
import {
  buildAdjustReason,
  buildStockLines,
  STOCK_ADJUST_REASONS,
  stockRowKey,
  type StockGridMode,
  type StockGridRow,
} from '@/lib/stockAdjust';

export interface StockAdjustTarget {
  productId: string;
  /** Título: el producto, o «producto · talla» si es una sola. */
  name: string;
  rows: StockGridRow[];
}

interface StockAdjustDialogProps {
  target: StockAdjustTarget | null;
  onClose: () => void;
  onDone?: () => void;
}

export function StockAdjustDialog({ target, onClose, onDone }: StockAdjustDialogProps) {
  const { adjustLines, isAdjusting } = useStockAdjust();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<StockGridMode>('set');
  const [reason, setReason] = useState<string>(STOCK_ADJUST_REASONS[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => target?.rows ?? [], [target]);
  const single = rows.length === 1;

  useEffect(() => {
    if (!target) return;
    // Una sola línea empieza con su stock; en la rejilla, en blanco (= sin cambio).
    setInputs(target.rows.length === 1 ? { [stockRowKey(target.rows[0])]: String(target.rows[0].current) } : {});
    setMode('set');
    setReason(STOCK_ADJUST_REASONS[0]);
    setNote('');
    setError(null);
  }, [target]);

  const preview = useMemo(() => buildStockLines(rows, inputs, mode), [rows, inputs, mode]);
  const nextOf = (row: StockGridRow) =>
    preview.lines.find((l) => l.variant_id === row.variantId)?.new_quantity ?? null;

  const changeMode = (add: boolean) => {
    setMode(add ? 'add' : 'set');
    setInputs(single && !add ? { [stockRowKey(rows[0])]: String(rows[0].current) } : {});
    setError(null);
  };

  const save = async () => {
    if (!target) return;
    if (preview.error) {
      setError(preview.error);
      return;
    }
    const text = buildAdjustReason(reason, note);
    if (!text) {
      setError('Explica el motivo en la nota');
      return;
    }
    const result = await adjustLines(target.productId, preview.lines, text);
    // Si el stock cambió mientras se editaba, se recarga para volver a empezar con lo de ahora.
    // Sin PIN (cancelado) o con error, la ventana sigue abierta con lo escrito.
    if (result === 'ok' || result === 'conflict') {
      onDone?.();
      onClose();
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn('max-h-[90vh] overflow-y-auto', single ? 'max-w-md' : 'max-w-lg')}>
        <DialogHeader>
          <DialogTitle>{single ? 'Ajustar stock' : 'Ajustar stock por tallas'}</DialogTitle>
          <DialogDescription>
            {target?.name}
            {single ? `: stock actual ${rows[0]?.current}.` : '.'} El ajuste queda en el historial con quién lo hizo
            y se manda a la tienda online.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <Label htmlFor="sa-sumar" className="text-sm font-normal">
              Sumar a lo que hay <span className="text-muted-foreground">(entrada de mercancía)</span>
            </Label>
            <Switch id="sa-sumar" checked={mode === 'add'} onCheckedChange={changeMode} />
          </div>

          {single ? (
            <div className="grid gap-1.5">
              <Label htmlFor="sa-cantidad">{mode === 'add' ? 'Unidades que entran (o salen, con −)' : 'Cantidad nueva'}</Label>
              <Input
                id="sa-cantidad"
                inputMode="numeric"
                value={inputs[stockRowKey(rows[0])] ?? ''}
                onChange={(e) => setInputs({ [stockRowKey(rows[0])]: e.target.value })}
                autoFocus
              />
              {mode === 'add' && nextOf(rows[0]) !== null && (
                <p className="text-xs text-muted-foreground">Quedarán {nextOf(rows[0])}</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_64px_96px_64px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Talla</span>
                <span className="text-right">Ahora</span>
                <span className="text-right">{mode === 'add' ? 'Entran' : 'Nuevo'}</span>
                <span className="text-right">Queda</span>
              </div>
              <div className="divide-y">
                {rows.map((row, i) => {
                  const key = stockRowKey(row);
                  const next = nextOf(row);
                  return (
                    <div key={key} className="grid grid-cols-[1fr_64px_96px_64px] items-center gap-2 px-3 py-1.5">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="text-right text-sm tabular-nums text-muted-foreground">{row.current}</span>
                      <Input
                        aria-label={`${mode === 'add' ? 'Unidades que entran' : 'Stock nuevo'} de la talla ${row.name}`}
                        inputMode="numeric"
                        className="h-8 text-right"
                        placeholder={mode === 'add' ? '0' : undefined}
                        value={inputs[key] ?? ''}
                        onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                        autoFocus={i === 0}
                      />
                      <span
                        className={cn(
                          'text-right text-sm tabular-nums',
                          next === null ? 'text-muted-foreground' : next > row.current ? 'text-primary font-semibold' : 'text-destructive font-semibold',
                        )}
                      >
                        {next ?? row.current}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
          {(error ?? preview.error) && <p className="text-sm text-destructive">{error ?? preview.error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isAdjusting}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={isAdjusting || preview.lines.length === 0 || !!preview.error}>
            {isAdjusting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {single || preview.lines.length <= 1 ? 'Guardar ajuste' : `Guardar ${preview.lines.length} tallas`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
