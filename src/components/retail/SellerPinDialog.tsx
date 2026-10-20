import { useEffect, useState } from 'react';
import { Delete, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { isValidPin, lockedMessage, sellableEmployees, type PosEmployee } from '@/lib/sellerSession';
import type { StartResult } from '@/contexts/SellerSessionContext';
import { cn } from '@/lib/utils';

interface SellerPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: PosEmployee[];
  onSubmit: (employeeId: string, pin: string) => Promise<StartResult>;
  /** Si el TPV exige vendedor, el diálogo no se puede cerrar sin identificarse. */
  required?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;

export function SellerPinDialog({ open, onOpenChange, employees, onSubmit, required }: SellerPinDialogProps) {
  const options = sellableEmployees(employees);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin('');
    setError(null);
    setEmployeeId(options.length === 1 ? options[0].id : null);
    // Solo al abrir: la lista no cambia mientras el diálogo está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!employeeId || !isValidPin(pin) || busy) return;
    setBusy(true);
    const result = await onSubmit(employeeId, pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.lockedSeconds > 0 ? lockedMessage(result.lockedSeconds) : (result.error ?? 'PIN incorrecto'));
      setPin('');
    }
  };

  const press = (key: (typeof KEYS)[number]) => {
    setError(null);
    if (key === 'borrar') setPin((p) => p.slice(0, -1));
    else if (key === 'ok') void submit();
    else setPin((p) => (p.length < 6 ? p + key : p));
  };

  const selected = options.find((e) => e.id === employeeId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => (required && !v ? undefined : onOpenChange(v))}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => required && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{selected ? `Hola, ${selected.name}` : '¿Quién atiende?'}</DialogTitle>
          <DialogDescription>
            {selected ? 'Introduce tu PIN para empezar a vender.' : 'Elige tu nombre y después introduce tu PIN.'}
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay dependientes con PIN. Un administrador puede crearlos en la pestaña <strong>Vendedores</strong>.
          </p>
        ) : !selected ? (
          <div className="grid grid-cols-2 gap-2">
            {options.map((e) => (
              <Button
                key={e.id}
                type="button"
                variant="outline"
                className="h-14 justify-start gap-2 text-base"
                onClick={() => setEmployeeId(e.id)}
              >
                <UserRound className="w-4 h-4 shrink-0" />
                <span className="truncate">{e.name}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              aria-label="PIN"
              value={pin}
              onChange={(e) => {
                setError(null);
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="h-12 text-center text-2xl tracking-[0.5em]"
              disabled={busy}
            />
            {error && (
              <p className="text-sm text-destructive text-center" role="alert">
                {error}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant={k === 'ok' ? 'default' : 'outline'}
                  className={cn('h-12 text-lg', k === 'borrar' && 'text-muted-foreground')}
                  onClick={() => press(k)}
                  disabled={busy || (k === 'ok' && !isValidPin(pin))}
                  aria-label={k === 'borrar' ? 'Borrar' : k === 'ok' ? 'Entrar' : k}
                >
                  {k === 'borrar' ? <Delete className="w-5 h-5" /> : k === 'ok' ? 'Entrar' : k}
                </Button>
              ))}
            </div>
            {options.length > 1 && (
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setEmployeeId(null)}>
                No soy {selected.name}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
