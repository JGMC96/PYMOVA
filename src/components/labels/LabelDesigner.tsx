import { ArrowDown, ArrowUp, Bold, Italic, Plus, Trash2, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  FIELD_LABELS, labelSizeMm, newField, type Align, type BarcodePosition, type LabelConfig, type LabelField,
  type LabelFieldKind, type LabelSheet,
} from '@/lib/labels';

const num = (s: string, fallback = 0) => {
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? fallback : n;
};

function NumberInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input className="h-8 w-24" type="number" step={step} value={value} onChange={(e) => onChange(num(e.target.value, value))} />
    </div>
  );
}

/** Editor del diseño: la hoja (o el rollo) y los campos, como en Stockagile. */
export function LabelDesigner({ config, onChange }: { config: LabelConfig; onChange: (c: LabelConfig) => void }) {
  const sheet = config.sheet;
  const size = labelSizeMm(sheet);
  const setSheet = (patch: Partial<LabelSheet>) => onChange({ ...config, sheet: { ...sheet, ...patch } });
  const setField = (id: string, patch: Partial<LabelField>) =>
    onChange({ ...config, fields: config.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const move = (i: number, d: -1 | 1) => {
    const fields = [...config.fields];
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    onChange({ ...config, fields });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Diseño de la hoja</h4>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Formato</Label>
            <Select value={sheet.mode} onValueChange={(v) => setSheet({ mode: v as LabelSheet['mode'] })}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sheet">Hoja A4 de etiquetas</SelectItem>
                <SelectItem value="roll">Rollo (una por página)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sheet.mode === 'sheet' ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Orientación</Label>
                <Select value={sheet.orientation} onValueChange={(v) => setSheet({ orientation: v as LabelSheet['orientation'] })}>
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Vertical</SelectItem>
                    <SelectItem value="landscape">Horizontal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput label="Filas por página" value={sheet.rows} onChange={(v) => setSheet({ rows: Math.max(1, Math.round(v)) })} />
              <NumberInput label="Etiquetas por fila" value={sheet.cols} onChange={(v) => setSheet({ cols: Math.max(1, Math.round(v)) })} />
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <NumberInput
                  key={side}
                  step={0.5}
                  label={`Margen ${{ top: 'superior', right: 'derecho', bottom: 'inferior', left: 'izquierdo' }[side]} (mm)`}
                  value={sheet.pageMarginsMm[side]}
                  onChange={(v) => setSheet({ pageMarginsMm: { ...sheet.pageMarginsMm, [side]: Math.max(0, v) } })}
                />
              ))}
            </>
          ) : (
            <>
              <NumberInput label="Ancho (mm)" step={0.5} value={sheet.rollWidthMm} onChange={(v) => setSheet({ rollWidthMm: Math.max(10, v) })} />
              <NumberInput label="Alto (mm)" step={0.5} value={sheet.rollHeightMm} onChange={(v) => setSheet({ rollHeightMm: Math.max(10, v) })} />
            </>
          )}
          <NumberInput label="Margen interior (mm)" step={0.5} value={sheet.paddingMm} onChange={(v) => setSheet({ paddingMm: Math.max(0, v) })} />
          <label className="flex items-center gap-2 text-sm pb-1.5">
            <Checkbox checked={sheet.border} onCheckedChange={(v) => setSheet({ border: v === true })} />
            Imprimir borde
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Tamaño de cada etiqueta: {size.width.toLocaleString('es-ES')} × {size.height.toLocaleString('es-ES')} mm
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Campos dentro de la etiqueta</h4>
        {config.fields.map((f, i) => (
          <div key={f.id} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
            <div className="w-40 text-sm font-medium pb-1.5">{FIELD_LABELS[f.kind]}</div>
            {f.kind === 'barcode' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Posición</Label>
                  <Select value={f.barcodePosition} onValueChange={(v) => setField(f.id, { barcodePosition: v as BarcodePosition })}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="right">A la derecha (vertical)</SelectItem>
                      <SelectItem value="left">A la izquierda (vertical)</SelectItem>
                      <SelectItem value="bottom">Abajo</SelectItem>
                      <SelectItem value="top">Arriba</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <NumberInput label="Alto (mm, 0 = auto)" step={0.5} value={f.barcodeSizeMm} onChange={(v) => setField(f.id, { barcodeSizeMm: Math.max(0, v) })} />
                <label className="flex items-center gap-2 text-sm pb-1.5">
                  <Checkbox checked={f.barcodeNumbers} onCheckedChange={(v) => setField(f.id, { barcodeNumbers: v === true })} />
                  Números
                </label>
              </>
            ) : (
              <>
                <NumberInput label="Tamaño" value={f.fontSize} onChange={(v) => setField(f.id, { fontSize: Math.min(48, Math.max(5, v)) })} />
                <div className="flex gap-1 pb-0.5">
                  {(['left', 'center', 'right'] as Align[]).map((a) => (
                    <Button
                      key={a}
                      type="button"
                      size="sm"
                      variant={f.align === a ? 'default' : 'outline'}
                      className="h-8 px-2 text-xs"
                      onClick={() => setField(f.id, { align: a })}
                    >
                      {{ left: 'Izq.', center: 'Centro', right: 'Der.' }[a]}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-1 pb-0.5">
                  {([['bold', Bold], ['italic', Italic], ['underline', Underline]] as const).map(([k, Icon]) => (
                    <Button
                      key={k}
                      type="button"
                      size="icon"
                      variant={f[k] ? 'default' : 'outline'}
                      className="h-8 w-8"
                      aria-label={{ bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado' }[k]}
                      onClick={() => setField(f.id, { [k]: !f[k] } as Partial<LabelField>)}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </Button>
                  ))}
                </div>
                {f.kind === 'text' ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Texto</Label>
                    <Input className="h-8 w-48" value={f.text} onChange={(e) => setField(f.id, { text: e.target.value })} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Texto delante</Label>
                    <Input className="h-8 w-28" value={f.prefix} onChange={(e) => setField(f.id, { prefix: e.target.value })} />
                  </div>
                )}
                {f.kind === 'price' && (
                  <label className="flex items-center gap-2 text-sm pb-1.5">
                    <Checkbox checked={f.priceWithoutTax} onCheckedChange={(v) => setField(f.id, { priceWithoutTax: v === true })} />
                    Sin IVA
                  </label>
                )}
              </>
            )}
            <div className="ml-auto flex gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Subir" onClick={() => move(i, -1)}>
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Bajar" onClick={() => move(i, 1)}>
                <ArrowDown className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 text-destructive')}
                aria-label={`Quitar ${FIELD_LABELS[f.kind]}`}
                onClick={() => onChange({ ...config, fields: config.fields.filter((x) => x.id !== f.id) })}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        <Select
          value=""
          onValueChange={(kind) => onChange({ ...config, fields: [...config.fields, newField(kind as LabelFieldKind)] })}
        >
          <SelectTrigger className="h-9 w-56">
            <span className="flex items-center gap-1.5 text-sm"><Plus className="w-4 h-4" /> Añadir otro campo</span>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FIELD_LABELS) as LabelFieldKind[])
              .filter((k) => k !== 'barcode' || !config.fields.some((f) => f.kind === 'barcode'))
              .map((k) => <SelectItem key={k} value={k}>{FIELD_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </section>
    </div>
  );
}
