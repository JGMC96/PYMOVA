import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MonthlyReportRow, SessionCorrection } from '@/hooks/useHrReports';
import { buildCorrection } from '@/lib/timeCorrection';

interface CorrectSessionDialogProps {
  session: MonthlyReportRow | null;
  onClose: () => void;
  onSubmit: (sessionId: string, correction: SessionCorrection) => Promise<boolean>;
}

export function CorrectSessionDialog({ session, onClose, onSubmit }: CorrectSessionDialogProps) {
  const [date, setDate] = useState('');
  const [entrada, setEntrada] = useState('');
  const [salida, setSalida] = useState('');
  const [pausa, setPausa] = useState('0');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const inicio = new Date(session.clock_in_at);
    setDate(format(inicio, 'yyyy-MM-dd'));
    setEntrada(format(inicio, 'HH:mm'));
    setSalida(session.clock_out_at ? format(new Date(session.clock_out_at), 'HH:mm') : '');
    setPausa(String(Math.round(session.break_seconds / 60)));
    setMotivo('');
    setError(null);
  }, [session]);

  const guardar = async () => {
    if (!session) return;
    const result = buildCorrection({ date, entrada, salida, pausaMinutos: pausa, motivo });
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    const ok = await onSubmit(session.id, result.correction);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corregir fichaje</DialogTitle>
          <DialogDescription>
            La corrección queda registrada con tu usuario y el motivo. Los fichajes originales no se borran.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cs-fecha">Fecha</Label>
              <Input id="cs-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cs-entrada">Entrada</Label>
              <Input id="cs-entrada" type="time" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cs-salida">Salida</Label>
              <Input id="cs-salida" type="time" value={salida} onChange={(e) => setSalida(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cs-pausa">Pausas (minutos)</Label>
            <Input id="cs-pausa" type="number" min={0} value={pausa} onChange={(e) => setPausa(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cs-motivo">Motivo</Label>
            <Textarea
              id="cs-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: olvidó fichar la salida; salió a las 14:00 según el cuadrante"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar corrección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
