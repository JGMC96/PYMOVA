import { useEffect, useState } from 'react';
import { Delete, ShieldCheck, UserRound, UserRoundPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import {
  isValidPin,
  lockedMessage,
  SELLER_SESSION_HOURS,
  sellableEmployees,
  type PosAction,
  type PosEmployee,
} from '@/lib/sellerSession';
import { cn } from '@/lib/utils';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;

/**
 * Diálogo único de las personas del TPV (lo abre SellerSessionContext):
 * - «¿Quién ha hecho la venta?» con los conectados (sin PIN) y «Otra persona»;
 * - nombre y PIN para conectarse SELLER_SESSION_HOURS;
 * - cambiar el PIN con el actual;
 * - «Necesita autorización»: el PIN de alguien con el permiso (0030).
 */
export function SellerDialog() {
  const { dialog, sellers, employees, resolveDialog, setDialogMode, login, changePin, authorizersFor, authorizeWithPin } =
    useSellerSession();
  const open = !!dialog;
  const purpose = dialog?.purpose || 'la venta';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resolveDialog(null)}>
      <DialogContent className="sm:max-w-md">
        {dialog?.mode === 'ask' && (
          <>
            <DialogHeader>
              <DialogTitle>¿Quién ha hecho {purpose}?</DialogTitle>
              <DialogDescription>Toca tu nombre. Si no estás en la lista, entra con tu PIN.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {sellers.map((s) => (
                <Button
                  key={s.sessionId}
                  type="button"
                  variant="outline"
                  className="h-14 justify-start gap-2 text-base"
                  onClick={() => resolveDialog(s)}
                >
                  <UserRound className="w-4 h-4 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="h-14 justify-start gap-2 text-base"
                onClick={() => setDialogMode('login')}
              >
                <UserRoundPlus className="w-4 h-4 shrink-0" />
                Otra persona
              </Button>
            </div>
          </>
        )}
        {dialog?.mode === 'login' && (
          <LoginStep
            employees={employees}
            connectedIds={sellers.map((s) => s.employeeId)}
            title={dialog.purpose ? `¿Quién hace ${purpose}?` : 'Conectarse al TPV'}
            onLogin={async (employeeId, pin) => {
              const r = await login(employeeId, pin);
              if (r.ok) resolveDialog(r.seller);
              return r;
            }}
          />
        )}
        {dialog?.mode === 'authorize' && dialog.action && (
          <AuthorizeStep
            action={dialog.action}
            amount={dialog.amount ?? 0}
            purpose={purpose}
            options={authorizersFor(dialog.action, dialog.amount ?? 0)}
            onAuthorize={authorizeWithPin}
          />
        )}
        {dialog?.mode === 'change-pin' && (
          <ChangePinStep
            employees={employees}
            onChange={async (employeeId, oldPin, newPin) => {
              const r = await changePin(employeeId, oldPin, newPin);
              if (r.ok) resolveDialog(null);
              return r;
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type PinAnswer = { ok: boolean; error: string | null; lockedSeconds: number };

function errorText(r: PinAnswer): string {
  return r.lockedSeconds > 0 ? lockedMessage(r.lockedSeconds) : (r.error ?? 'PIN incorrecto');
}

function NamePicker({
  options,
  onPick,
  highlight = [],
}: {
  options: PosEmployee[];
  onPick: (id: string) => void;
  highlight?: string[];
}) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay dependientes con PIN. Un administrador puede crearlos en la pestaña <strong>Vendedores</strong>.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((e) => (
        <Button
          key={e.id}
          type="button"
          variant="outline"
          className={cn('h-14 justify-start gap-2 text-base', highlight.includes(e.id) && 'border-primary')}
          onClick={() => onPick(e.id)}
        >
          <UserRound className="w-4 h-4 shrink-0" />
          <span className="truncate">{e.name}</span>
        </Button>
      ))}
    </div>
  );
}

function PinPad({
  value,
  onChange,
  onSubmit,
  busy,
  label = 'PIN',
  submitLabel = 'Entrar',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  label?: string;
  submitLabel?: string;
}) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'borrar') onChange(value.slice(0, -1));
    else if (key === 'ok') onSubmit();
    else if (value.length < 6) onChange(value + key);
  };
  return (
    <div className="space-y-3">
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="h-12 text-center text-2xl tracking-[0.5em]"
        disabled={busy}
      />
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Button
            key={k}
            type="button"
            variant={k === 'ok' ? 'default' : 'outline'}
            className={cn('h-12 text-lg', k === 'borrar' && 'text-muted-foreground')}
            onClick={() => press(k)}
            disabled={busy || (k === 'ok' && !isValidPin(value))}
            aria-label={k === 'borrar' ? 'Borrar' : k === 'ok' ? submitLabel : k}
          >
            {k === 'borrar' ? <Delete className="w-5 h-5" /> : k === 'ok' ? submitLabel : k}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LoginStep({
  employees,
  connectedIds,
  title,
  onLogin,
}: {
  employees: PosEmployee[];
  connectedIds: string[];
  title: string;
  onLogin: (employeeId: string, pin: string) => Promise<PinAnswer>;
}) {
  const options = sellableEmployees(employees);
  const [employeeId, setEmployeeId] = useState<string | null>(options.length === 1 ? options[0].id : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = options.find((e) => e.id === employeeId) ?? null;

  const submit = async () => {
    if (!employeeId || !isValidPin(pin) || busy) return;
    setBusy(true);
    const r = await onLogin(employeeId, pin);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r));
      setPin('');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{selected ? `Hola, ${selected.name}` : title}</DialogTitle>
        <DialogDescription>
          {selected
            ? `Introduce tu PIN. Quedarás conectado ${SELLER_SESSION_HOURS} horas en este TPV.`
            : 'Elige tu nombre y después introduce tu PIN.'}
        </DialogDescription>
      </DialogHeader>
      {!selected ? (
        <NamePicker options={options} onPick={setEmployeeId} highlight={connectedIds} />
      ) : (
        <div className="space-y-3">
          <PinPad
            value={pin}
            onChange={(v) => {
              setError(null);
              setPin(v);
            }}
            onSubmit={() => void submit()}
            busy={busy}
          />
          {error && (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          )}
          {options.length > 1 && (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setEmployeeId(null)}>
              No soy {selected.name}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function ChangePinStep({
  employees,
  onChange,
}: {
  employees: PosEmployee[];
  onChange: (employeeId: string, oldPin: string, newPin: string) => Promise<PinAnswer>;
}) {
  const options = sellableEmployees(employees);
  const [employeeId, setEmployeeId] = useState<string | null>(options.length === 1 ? options[0].id : null);
  const [step, setStep] = useState<'old' | 'new'>('old');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = options.find((e) => e.id === employeeId) ?? null;

  useEffect(() => {
    setStep('old');
    setOldPin('');
    setNewPin('');
    setRepeat('');
    setError(null);
  }, [employeeId]);

  const submit = async () => {
    if (!employeeId || busy) return;
    if (!isValidPin(newPin) || newPin !== repeat) {
      setError('Los dos PIN nuevos no coinciden.');
      return;
    }
    setBusy(true);
    const r = await onChange(employeeId, oldPin, newPin);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r));
      setStep('old');
      setOldPin('');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{selected ? `Cambiar el PIN de ${selected.name}` : 'Cambiar mi PIN'}</DialogTitle>
        <DialogDescription>
          {!selected
            ? 'Elige tu nombre.'
            : step === 'old'
              ? 'Introduce tu PIN actual.'
              : 'Elige un PIN nuevo de 4 a 6 cifras y repítelo. Después tendrás que volver a conectarte.'}
        </DialogDescription>
      </DialogHeader>
      {!selected ? (
        <NamePicker options={options} onPick={setEmployeeId} />
      ) : step === 'old' ? (
        <div className="space-y-3">
          <PinPad
            value={oldPin}
            onChange={(v) => {
              setError(null);
              setOldPin(v);
            }}
            onSubmit={() => isValidPin(oldPin) && setStep('new')}
            busy={busy}
            label="PIN actual"
            submitLabel="Seguir"
          />
          {error && (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pin-nuevo">PIN nuevo</Label>
            <Input
              id="pin-nuevo"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={newPin}
              onChange={(e) => {
                setError(null);
                setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin-repite">Repite el PIN nuevo</Label>
            <Input
              id="pin-repite"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={repeat}
              onChange={(e) => {
                setError(null);
                setRepeat(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="button" className="w-full" onClick={() => void submit()} disabled={busy || !isValidPin(newPin) || newPin !== repeat}>
            Guardar PIN nuevo
          </Button>
        </div>
      )}
    </>
  );
}

const ACTION_TEXT: Record<PosAction, (amount: number) => string> = {
  discount: (amount) =>
    `El descuento es del ${amount.toFixed(2).replace('.', ',')} %, por encima del máximo de quien vende. Lo autoriza alguien con un máximo igual o mayor.`,
  return: () => 'Quien hace la devolución no tiene ese permiso. La autoriza alguien que pueda hacer devoluciones.',
  close_register: () => 'Quien cierra no tiene ese permiso. Lo autoriza alguien que pueda cerrar la caja.',
};

function AuthorizeStep({
  action,
  amount,
  purpose,
  options,
  onAuthorize,
}: {
  action: PosAction;
  amount: number;
  purpose: string;
  options: PosEmployee[];
  onAuthorize: (employeeId: string, pin: string) => Promise<PinAnswer>;
}) {
  const [employeeId, setEmployeeId] = useState<string | null>(options.length === 1 ? options[0].id : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = options.find((e) => e.id === employeeId) ?? null;

  const submit = async () => {
    if (!employeeId || !isValidPin(pin) || busy) return;
    setBusy(true);
    const r = await onAuthorize(employeeId, pin);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r));
      setPin('');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          Necesita autorización
        </DialogTitle>
        <DialogDescription>
          {purpose ? `${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}. ` : ''}
          {ACTION_TEXT[action](amount)}
        </DialogDescription>
      </DialogHeader>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nadie con PIN puede autorizarlo. El propietario puede dar el permiso en <strong>Vendedores › Permisos</strong>.
        </p>
      ) : !selected ? (
        <NamePicker options={options} onPick={setEmployeeId} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Autoriza: <strong>{selected.name}</strong>
          </p>
          <PinPad
            value={pin}
            onChange={(v) => {
              setError(null);
              setPin(v);
            }}
            onSubmit={() => void submit()}
            busy={busy}
            submitLabel="Autorizar"
          />
          {error && (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          )}
          {options.length > 1 && (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setEmployeeId(null)}>
              Elegir a otra persona
            </Button>
          )}
        </div>
      )}
    </>
  );
}
