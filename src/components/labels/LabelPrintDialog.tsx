import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import { useLabelTemplates } from '@/hooks/useLabelTemplates';
import { DEFAULT_TAX_RATE } from '@/lib/tax';
import { expandLabels, printLabels, type LabelData } from '@/lib/labels';
import { LabelPreview } from './LabelPreview';

/** Imprimir etiquetas de una lista ya hecha (p. ej. lo recibido en una compra). */
export function LabelPrintDialog({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: { data: LabelData; quantity: number }[];
}) {
  const { templates } = useLabelTemplates();
  const { settings } = useBusinessSettings();
  const taxRate = settings?.tax_rate ?? DEFAULT_TAX_RATE;
  const [templateKey, setTemplateKey] = useState('');
  const [startAt, setStartAt] = useState('1');

  useEffect(() => {
    if (open) {
      setTemplateKey(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? 'builtin');
      setStartAt('1');
    }
  }, [open, templates]);

  const template = templates.find((t) => (t.id ?? 'builtin') === templateKey) ?? templates[0];
  const config = template.config;
  const start = config.sheet.mode === 'sheet' ? Math.max(1, Math.floor(Number(startAt) || 1)) : 1;
  const labels = expandLabels(items, start);
  const count = labels.filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{count} etiquetas. Se imprimen con el diseño elegido.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Diseño</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id ?? 'builtin'} value={t.id ?? 'builtin'}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {config.sheet.mode === 'sheet' && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Empezar en la nº</Label>
              <Input className="h-9 w-20" type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
          )}
        </div>
        {items[0] && <LabelPreview config={config} data={items[0].data} taxRate={taxRate} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button disabled={count === 0} onClick={() => printLabels(config, labels, taxRate)}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir o guardar en PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
