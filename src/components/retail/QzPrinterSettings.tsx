import { useState } from 'react';
import { Loader2, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { useBusiness } from '@/contexts/BusinessContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { checkQz, connectQz, printRaw } from '@/lib/qzTray';
import type { TerminalTicketPrefs } from '@/lib/ticket';
import { ESC_POS_DRAWER } from '@/lib/ticketPrint';

const NONE = '__none__';
const DOCUMENTS: { key: keyof TerminalTicketPrefs['printers']; label: string; hint: string }[] = [
  { key: 'ticket', label: 'Tickets', hint: 'Ventas.' },
  { key: 'refund', label: 'Abonos', hint: 'Sin elegir: la de tickets.' },
  { key: 'duplicate', label: 'Duplicados', hint: 'Sin elegir: la de tickets.' },
  { key: 'label', label: 'Etiquetas', hint: 'Solo diseños de rollo.' },
];

interface QzPrinterSettingsProps {
  prefs: TerminalTicketPrefs;
  setPrefs: (p: TerminalTicketPrefs) => void;
}

/** Impresión con QZ Tray de este equipo: se guarda en el navegador, no en el negocio. */
export function QzPrinterSettings({ prefs, setPrefs }: QzPrinterSettingsProps) {
  const { activeBusiness } = useBusiness();
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<{ version: string; printers: string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const check = async () => {
    if (!activeBusiness?.id) return;
    setChecking(true);
    setProblem(null);
    try {
      setFound(await checkQz(activeBusiness.id));
    } catch (e) {
      setFound(null);
      setProblem(e instanceof Error ? e.message : 'No se ha podido comprobar QZ Tray.');
    } finally {
      setChecking(false);
    }
  };

  const setPrinter = (key: keyof TerminalTicketPrefs['printers'], value: string) => {
    setPrefs({ ...prefs, printers: { ...prefs.printers, [key]: value === NONE ? undefined : value } });
  };

  const testDrawer = async () => {
    if (!activeBusiness?.id || !prefs.printers.ticket) return;
    const qz = await connectQz(activeBusiness.id);
    if (!qz) {
      toast.error('QZ Tray no responde.');
      return;
    }
    await printRaw(qz, prefs.printers.ticket, ESC_POS_DRAWER).catch((e) => {
      toast.error(`No se ha podido abrir el cajón: ${e instanceof Error ? e.message : 'error desconocido'}`);
    });
  };

  // Lo ya elegido se enseña aunque aún no se haya comprobado o la impresora no esté encendida.
  const optionsFor = (current?: string) =>
    Array.from(new Set([...(current ? [current] : []), ...(found?.printers ?? [])]));

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="qz-enabled">Imprimir con QZ Tray en este equipo</Label>
          <p className="text-xs text-muted-foreground">
            Sin cuadro de impresión, con corte y cajón. Si QZ Tray no responde, se imprime como siempre.
          </p>
        </div>
        <Switch id="qz-enabled" checked={prefs.qzEnabled} onCheckedChange={(v) => setPrefs({ ...prefs, qzEnabled: v })} />
      </div>

      {prefs.qzEnabled && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
              {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plug className="w-4 h-4 mr-2" />}
              Comprobar y buscar impresoras
            </Button>
            {found && <span className="text-xs text-muted-foreground">QZ Tray {found.version}: {found.printers.length} impresoras</span>}
          </div>
          {problem && <p className="text-xs text-destructive">{problem}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {DOCUMENTS.map(({ key, label, hint }) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Select value={prefs.printers[key] ?? NONE} onValueChange={(v) => setPrinter(key, v)}>
                  <SelectTrigger aria-label={`Impresora de ${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin elegir</SelectItem>
                    {optionsFor(prefs.printers[key]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="qz-cut">Cortar el papel al acabar cada ticket</Label>
            <Switch id="qz-cut" checked={prefs.qzCut} onCheckedChange={(v) => setPrefs({ ...prefs, qzCut: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="qz-drawer">Hay cajón conectado a la impresora de tickets</Label>
              <p className="text-xs text-muted-foreground">Se abre solo en cobros y devoluciones en efectivo, nunca en duplicados.</p>
            </div>
            <Switch id="qz-drawer" checked={prefs.qzDrawer} onCheckedChange={(v) => setPrefs({ ...prefs, qzDrawer: v })} />
          </div>
          {prefs.qzDrawer && (
            <Button type="button" variant="outline" size="sm" onClick={() => void testDrawer()} disabled={!prefs.printers.ticket}>
              Probar el cajón
            </Button>
          )}
        </>
      )}
    </div>
  );
}
