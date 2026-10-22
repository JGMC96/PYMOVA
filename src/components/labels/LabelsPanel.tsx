import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Printer, ScanLine, Search, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useInventory, type ProductWithStock } from '@/hooks/useInventory';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useLabelTemplates, BUILTIN_TEMPLATE, type LabelTemplate } from '@/hooks/useLabelTemplates';
import { DEFAULT_TAX_RATE } from '@/lib/tax';
import {
  expandLabels, labelDataFor, labelSizeMm, loadStartPosition, nextStartPosition, printLabels, saveStartPosition,
  sortLabelRows, type LabelConfig, type LabelData, type LabelOrder,
} from '@/lib/labels';
import { LabelDesigner } from './LabelDesigner';
import { LabelPreview } from './LabelPreview';
import { toast } from 'sonner';

interface Row {
  key: string;
  productName: string;
  sizeName: string | null;
  stock: number;
  data: LabelData;
  quantity: number;
}

const SAMPLE: LabelData = { name: 'Zueco Bolonia Piel Negro', color: 'Piel Negro', size: '38', price: 89, sku: 'TFW23ZU000NE38', barcode: '9600000021138' };

function rowsFor(p: ProductWithStock, quantity: (stock: number) => number): Row[] {
  const variants = p.variants.filter((v) => v.is_active);
  if (variants.length === 0) {
    return [{ key: p.id, productName: p.name, sizeName: null, stock: p.stock_quantity, data: labelDataFor(p), quantity: quantity(p.stock_quantity) }];
  }
  return variants.map((v) => ({
    key: v.id,
    productName: p.name,
    sizeName: v.name,
    stock: v.stock_quantity,
    data: labelDataFor(p, v),
    quantity: quantity(v.stock_quantity),
  }));
}

/** Etiquetas de producto: diseño (como en Stockagile), artículos y cantidades, e impresión. */
export function LabelsPanel() {
  const { products } = useInventory();
  const { settings } = useBusinessSettings();
  const { canAdjustStock } = useMyPermissions();
  const { templates, save, remove, isSaving } = useLabelTemplates();
  const taxRate = settings?.tax_rate ?? DEFAULT_TAX_RATE;

  const [selectedId, setSelectedId] = useState<string>('builtin');
  const [draft, setDraft] = useState<LabelTemplate>(BUILTIN_TEMPLATE);
  const [designOpen, setDesignOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [scan, setScan] = useState('');
  const [startAt, setStartAt] = useState('1');
  const [order, setOrder] = useState<LabelOrder>('added');

  // En hoja A4 se sigue donde se quedó la última impresión con ese diseño en este ordenador.
  useEffect(() => {
    setStartAt(String(loadStartPosition(selectedId)));
  }, [selectedId]);

  // Al cargar o cambiar de diseño, se edita una copia.
  useEffect(() => {
    const t = templates.find((x) => (x.id ?? 'builtin') === selectedId) ?? templates[0];
    if (t) {
      setDraft(t);
      setSelectedId(t.id ?? 'builtin');
    }
  }, [templates, selectedId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.variants.some((v) => v.sku?.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [products, query]);

  const addRows = (newRows: Row[]) =>
    setRows((prev) => {
      const map = new Map(prev.map((r) => [r.key, r]));
      for (const r of newRows) {
        const old = map.get(r.key);
        map.set(r.key, old ? { ...old, quantity: old.quantity + r.quantity } : r);
      }
      return [...map.values()];
    });

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    setScan('');
    if (!code) return;
    for (const p of products) {
      const v = p.variants.find((x) => x.barcode === code || x.sku === code);
      if (v) {
        addRows([{ key: v.id, productName: p.name, sizeName: v.name, stock: v.stock_quantity, data: labelDataFor(p, v), quantity: 1 }]);
        return;
      }
      if (p.barcode === code || p.sku === code) {
        addRows(rowsFor(p, () => 1));
        return;
      }
    }
    toast.error(`Sin coincidencias para «${code}»`);
  };

  const config: LabelConfig = draft.config;
  const start = draft.config.sheet.mode === 'sheet' ? Math.max(1, Math.floor(Number(startAt) || 1)) : 1;
  const labels = expandLabels(sortLabelRows(rows.map((r) => ({ data: r.data, quantity: r.quantity })), order), start);
  const count = labels.filter(Boolean).length;
  const missing = rows.filter((r) => !r.data.barcode).reduce((s, r) => s + r.quantity, 0);
  const perPage = config.sheet.mode === 'roll' ? 1 : config.sheet.rows * config.sheet.cols;
  const pages = Math.ceil(labels.length / perPage);
  const size = labelSizeMm(config.sheet);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Diseño</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id ?? 'builtin'} value={t.id ?? 'builtin'}>
                    {t.name}{t.is_default && t.id ? ' (por defecto)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canAdjustStock && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Nombre del diseño</Label>
                <Input className="h-9 w-56" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <Button
                variant="outline"
                disabled={isSaving || !draft.name.trim()}
                onClick={async () => {
                  const id = await save(draft, true);
                  if (id) setSelectedId(id);
                }}
              >
                Guardar como nuevo diseño
              </Button>
              <Button
                disabled={isSaving || !draft.name.trim()}
                onClick={async () => {
                  const id = await save(draft);
                  if (id) setSelectedId(id);
                }}
              >
                Guardar diseño
              </Button>
              {draft.id && !draft.is_default && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`¿Borrar el diseño «${draft.name}»?`)) return;
                    await remove(draft.id!);
                    setSelectedId('builtin');
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Borrar
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:items-start">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Vista previa · {size.width.toLocaleString('es-ES')} × {size.height.toLocaleString('es-ES')} mm
            </p>
            <LabelPreview config={config} data={rows[0]?.data ?? SAMPLE} taxRate={taxRate} />
          </div>
          {canAdjustStock && (
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setDesignOpen((v) => !v)}
            >
              {designOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Diseño de la hoja y campos
            </button>
          )}
        </div>
        {canAdjustStock && designOpen && (
          <LabelDesigner config={config} onChange={(c) => setDraft({ ...draft, config: c })} />
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar producto por nombre o SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results.length > 0 && (
              <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                {results.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent/60">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => { addRows(rowsFor(p, () => 1)); setQuery(''); }}>
                        1 de cada
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { addRows(rowsFor(p, (s) => Math.max(0, s))); setQuery(''); }}>
                        Según stock
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={handleScan} className="relative lg:w-72">
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
            <Input className="pl-9" placeholder="Escanear código" value={scan} onChange={(e) => setScan(e.target.value)} />
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Busca o escanea los artículos que quieres etiquetar.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.productName}{r.sizeName ? ` · ${r.sizeName}` : ''}</p>
                  <p className="text-xs text-muted-foreground">
                    {[r.data.barcode, r.data.sku, `stock ${r.stock}`].filter(Boolean).join(' · ')}
                    {!r.data.barcode && <span className="text-amber-600 dark:text-amber-400"> · sin código de barras</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    className="h-8 w-20 text-center"
                    aria-label={`Etiquetas de ${r.productName}`}
                    value={r.quantity}
                    onChange={(e) => {
                      const q = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, quantity: q } : x)));
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Quitar" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-3">
            {config.sheet.mode === 'sheet' && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Empezar en la etiqueta nº</Label>
                <Input className="h-9 w-24" type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Orden</Label>
              <Select value={order} onValueChange={(v) => setOrder(v as LabelOrder)}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="added">Como en la lista</SelectItem>
                  <SelectItem value="product">Producto y talla</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground pb-2">
              {count} etiquetas · {pages} {pages === 1 ? 'página' : 'páginas'}
              {missing > 0 && <span className="text-amber-600 dark:text-amber-400"> · {missing} sin código de barras</span>}
            </p>
            {rows.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setRows([])}>Vaciar</Button>
            )}
          </div>
          <Button
            disabled={count === 0}
            onClick={() => {
              printLabels(config, labels, taxRate);
              if (config.sheet.mode === 'sheet') saveStartPosition(selectedId, nextStartPosition(start, count, perPage));
              setStartAt(String(loadStartPosition(selectedId)));
            }}
          >
            <Printer className="w-4 h-4 mr-2" />
            Imprimir o guardar en PDF
          </Button>
        </div>
      </Card>
    </div>
  );
}
