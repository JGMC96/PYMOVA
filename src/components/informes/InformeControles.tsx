// Controles comunes de todos los informes: selector de periodo y botón de exportar a CSV.
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRESET_LABEL, type Preset } from '@/lib/periodos';
import { downloadCsv } from '@/lib/informes';

interface PeriodSelectorProps {
  preset: Preset;
  from: string;
  to: string;
  onPreset: (preset: Preset) => void;
  onFrom: (from: string) => void;
  onTo: (to: string) => void;
}

export function PeriodSelector({ preset, from, to, onPreset, onFrom, onTo }: PeriodSelectorProps) {
  const invalid = !from || !to || from > to;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="informe-periodo">Periodo</Label>
        <Select value={preset} onValueChange={(v) => onPreset(v as Preset)}>
          <SelectTrigger id="informe-periodo" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PRESET_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="informe-desde">Desde</Label>
        <Input id="informe-desde" type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="informe-hasta">Hasta</Label>
        <Input id="informe-hasta" type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      {invalid && <p className="pb-2 text-sm text-destructive">Revisa las fechas: «Desde» no puede ser posterior a «Hasta».</p>}
    </div>
  );
}

interface ExportCsvButtonProps {
  filename: string;
  build: () => string;
  disabled?: boolean;
}

export function ExportCsvButton({ filename, build, disabled }: ExportCsvButtonProps) {
  return (
    <Button variant="outline" disabled={disabled} onClick={() => downloadCsv(filename, build())}>
      <Download className="w-4 h-4 mr-2" />
      Exportar CSV
    </Button>
  );
}
