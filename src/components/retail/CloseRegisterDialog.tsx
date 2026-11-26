import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Lock, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RegisterSession, RegisterSummaryRow } from '@/hooks/useCashRegister';
import {
  cashOutcome, countTotal, DENOMINATIONS, denominationLabel, expectedBreakdown, parseCash, withdrawalPlan,
  type ClosingDoc,
} from '@/lib/cierreCaja';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const toInput = (n: number) => n.toFixed(2).replace('.', ',');

export interface CloseRequest {
  /** Todo el efectivo contado en el cajón (fondo incluido). */
  countedTotal: number;
  /** Lo que se apunta como «Retirada al banco» antes de cerrar. */
  withdrawal: number;
  /** Lo que queda en el cajón: es lo que se guarda como contado al cerrar. */
  keep: number;
  notes: string;
}

type Step = 1 | 2 | 3 | 4;

/**
 * Cierre de caja guiado en 4 pasos: el turno (y qué debería haber en el cajón), contar todo el
 * efectivo, cuánto se deja para mañana (el resto se apunta como retirada) y el resumen.
 */
export function CloseRegisterDialog({
  open,
  onOpenChange,
  session,
  summary,
  isBlind,
  cashRefunds,
  movements,
  defaultKeep,
  isWorking,
  closedSession,
  personName,
  onConfirm,
  onPrint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RegisterSession | null;
  summary: RegisterSummaryRow[];
  isBlind: boolean;
  cashRefunds: number;
  movements: { cashIn: number; expenses: number; withdrawals: number };
  /** Lo que se propone dejar para mañana (el fondo de siempre). */
  defaultKeep: number;
  isWorking: boolean;
  /** La caja ya cerrada (del historial), para el resumen final. */
  closedSession: RegisterSession | null;
  personName: (id: string | null | undefined) => string;
  onConfirm: (req: CloseRequest) => Promise<boolean>;
  onPrint: (doc: ClosingDoc) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [byCoins, setByCoins] = useState(false);
  const [coins, setCoins] = useState<Record<string, string>>({});
  const [countedRaw, setCountedRaw] = useState('');
  const [cardRaw, setCardRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [keepRaw, setKeepRaw] = useState('');
  const [request, setRequest] = useState<CloseRequest | null>(null);
  const [snapshot, setSnapshot] = useState<{ session: RegisterSession; summary: RegisterSummaryRow[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setByCoins(false);
    setCoins({});
    setCountedRaw('');
    setCardRaw('');
    setNotes('');
    setKeepRaw(toInput(defaultKeep));
    setRequest(null);
    setSnapshot(null);
    // Solo al abrir el asistente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cashRow = summary.find((s) => s.payment_method === 'cash');
  const cardRow = summary.find((s) => s.payment_method === 'card');
  const expected = useMemo(
    () => (isBlind || !session
      ? null
      : expectedBreakdown({
        opening: Number(session.opening_amount ?? 0),
        cashSales: Number(cashRow?.total_amount ?? 0),
        cashRefunds,
        cashIn: movements.cashIn,
        expenses: movements.expenses,
        withdrawals: movements.withdrawals,
      })),
    [isBlind, session, cashRow, cashRefunds, movements],
  );

  // Por billetes, nada contado hasta que se escribe alguno (si no, saldría «Faltan …» de entrada).
  const counted = byCoins
    ? (Object.values(coins).some((v) => v.trim() !== '') ? countTotal(coins) : null)
    : parseCash(countedRaw);
  const outcome = counted !== null && expected ? cashOutcome(counted, expected.total) : null;
  const notesRequired = !!outcome && !outcome.ok;
  const card = cardRaw.trim() ? parseCash(cardRaw) : null;
  const cardSales = cardRow?.total_amount == null ? null : Number(cardRow.total_amount);
  const cardOutcome = card !== null && cardSales !== null ? cashOutcome(card, cardSales) : null;

  const keepWanted = parseCash(keepRaw);
  const plan = counted !== null && keepWanted !== null
    ? withdrawalPlan(counted, keepWanted, expected ? expected.total : null)
    : null;

  const canCount = counted !== null && (!notesRequired || notes.trim().length >= 3);
  const canClose = !!plan && !plan.problem && !isWorking;

  const confirm = async () => {
    if (!plan || plan.problem || counted === null || !session) return;
    const req: CloseRequest = { countedTotal: counted, withdrawal: plan.withdrawal, keep: plan.keep, notes: notes.trim() };
    setSnapshot({ session, summary });
    const ok = await onConfirm(req);
    if (ok) {
      setRequest(req);
      setStep(4);
    }
  };

  const doc: ClosingDoc | null = useMemo(() => {
    if (step !== 4 || !request || !snapshot) return null;
    const s = closedSession;
    const payments = snapshot.summary
      .filter((r) => Number(r.sales_count) > 0)
      .map((r) => ({
        method: r.payment_method,
        label: PAYMENT_LABELS[r.payment_method] ?? r.payment_method,
        count: Number(r.sales_count),
        amount: r.total_amount === null ? null : Number(r.total_amount),
      }));
    // Lo del servidor manda: esperado y diferencia los calcula close_register_session, ya sin la retirada.
    const serverExpected = s?.expected_amount == null ? null : Number(s.expected_amount) + request.withdrawal;
    return {
      openedAt: snapshot.session.opened_at,
      closedAt: s?.closed_at ?? new Date().toISOString(),
      openedBy: snapshot.session.opened_by_employee_id ? personName(snapshot.session.opened_by_employee_id) : null,
      closedBy: s?.closed_by_employee_id ? personName(s.closed_by_employee_id) : null,
      opening: Number(snapshot.session.opening_amount ?? 0),
      payments,
      cashRefunds: isBlind ? null : cashRefunds,
      cashIn: isBlind ? null : movements.cashIn,
      expenses: isBlind ? null : movements.expenses,
      withdrawalsBefore: isBlind ? null : movements.withdrawals,
      expected: serverExpected ?? expected?.total ?? null,
      countedTotal: request.countedTotal,
      difference: s?.difference == null ? outcome?.difference ?? null : Number(s.difference),
      withdrawal: request.withdrawal,
      keep: request.keep,
      cardTerminal: card,
      notes: request.notes || null,
    };
  }, [step, request, snapshot, closedSession, personName, isBlind, cashRefunds, movements, expected, outcome, card]);

  const titles: Record<Step, string> = {
    1: '1 de 3 · El turno',
    2: '2 de 3 · Cuenta el efectivo',
    3: '3 de 3 · ¿Cuánto dejas para mañana?',
    4: 'Caja cerrada',
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isWorking) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cerrar caja · {titles[step]}</DialogTitle>
          <DialogDescription>
            {step === 1 && 'Repasa el turno antes de contar.'}
            {step === 2 && 'Cuenta todo el efectivo que hay ahora en el cajón, también el fondo.'}
            {step === 3 && 'Lo que no dejes en el cajón se apunta como «Retirada al banco».'}
            {step === 4 && 'El cierre está guardado. Puedes imprimir el resumen.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="font-medium">Ventas del turno</p>
              {summary.filter((r) => Number(r.sales_count) > 0).length === 0 ? (
                <p className="text-muted-foreground">Todavía no hay ventas en este turno.</p>
              ) : (
                summary.filter((r) => Number(r.sales_count) > 0).map((r) => (
                  <div key={r.payment_method} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {PAYMENT_LABELS[r.payment_method] ?? r.payment_method} · {r.sales_count}
                    </span>
                    <span>{r.total_amount === null ? '—' : fmt(Number(r.total_amount))}</span>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              <p className="font-medium">En el cajón debería haber</p>
              {expected ? (
                <>
                  {expected.lines.map((l) => (
                    <div key={l.label} className="flex justify-between">
                      <span className="text-muted-foreground">{l.label}</span>
                      <span className={cn(l.amount < 0 && 'text-destructive')}>
                        {l.amount < 0 ? `−${fmt(-l.amount)}` : fmt(l.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Efectivo esperado</span>
                    <span className="text-primary">{fmt(expected.total)}</span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Arqueo a ciegas: no se ve lo esperado. Cuenta el efectivo y la diferencia se verá al cerrar.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-sm">
            <p className="flex items-start gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Si ya has sacado del cajón el dinero de las ventas, cuéntalo también. En el paso siguiente decides cuánto
              se queda y PYMOVA apunta el resto como retirada.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={byCoins ? 'outline' : 'default'}
                aria-pressed={!byCoins}
                onClick={() => setByCoins(false)}
              >
                Escribir el total
              </Button>
              <Button
                type="button"
                size="sm"
                variant={byCoins ? 'default' : 'outline'}
                aria-pressed={byCoins}
                onClick={() => setByCoins(true)}
              >
                Contar billetes y monedas
              </Button>
            </div>
            {byCoins ? (
              <div className="grid grid-cols-3 gap-2">
                {DENOMINATIONS.map((d) => (
                  <div key={d} className="space-y-0.5">
                    <Label htmlFor={`coin-${d}`} className="text-xs text-muted-foreground">{denominationLabel(d)}</Label>
                    <Input
                      id={`coin-${d}`}
                      inputMode="numeric"
                      placeholder="0"
                      value={coins[String(d)] ?? ''}
                      onChange={(e) => setCoins((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="close-counted">Efectivo contado en el cajón</Label>
                <Input
                  id="close-counted"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={countedRaw}
                  onChange={(e) => setCountedRaw(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span>Contado</span>
              <span className="font-semibold">{counted === null ? '—' : fmt(counted)}</span>
            </div>
            {outcome && (
              <div
                className={cn(
                  'flex justify-between rounded-lg px-3 py-2 font-medium',
                  outcome.ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
                )}
              >
                <span>{outcome.text}</span>
                <span>Esperado {fmt(expected!.total)}</span>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="close-notes">
                Notas del arqueo{notesRequired ? ' (obligatorias si no cuadra)' : ' (opcional)'}
              </Label>
              <Textarea
                id="close-notes"
                rows={2}
                placeholder={notesRequired ? '¿Por qué no cuadra? Por ejemplo: cambio mal dado, venta cobrada con otra forma de pago…' : 'Incidencias del turno…'}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="close-card">Total del datáfono (opcional)</Label>
              <Input
                id="close-card"
                inputMode="decimal"
                placeholder="0,00"
                value={cardRaw}
                onChange={(e) => setCardRaw(e.target.value)}
              />
              {cardOutcome && (
                <p className={cn('text-xs', cardOutcome.ok ? 'text-primary' : 'text-destructive')}>
                  Tarjeta en PYMOVA {fmt(cardSales!)}: {cardOutcome.ok ? 'cuadra con el datáfono' : `${cardOutcome.text.toLowerCase()} en el datáfono`}.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 3 && counted !== null && (
          <div className="space-y-4 text-sm">
            <div className="flex justify-between rounded-lg border px-3 py-2">
              <span>Has contado</span>
              <span className="font-semibold">{fmt(counted)}</span>
            </div>
            <div className="space-y-1">
              <Label htmlFor="close-keep">Dejas en el cajón para mañana</Label>
              <Input
                id="close-keep"
                inputMode="decimal"
                value={keepRaw}
                onChange={(e) => setKeepRaw(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">Es el fondo con el que se abrirá la caja. 0 si no dejas nada.</p>
            </div>
            {plan?.problem ? (
              <p className="text-destructive">{plan.problem}</p>
            ) : plan && (
              <div className="space-y-1 rounded-lg border p-3">
                <div className="flex justify-between font-semibold">
                  <span>Retira al banco</span>
                  <span>{fmt(plan.withdrawal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Queda en el cajón</span>
                  <span>{fmt(plan.keep)}</span>
                </div>
                {plan.capped && (
                  <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
                    Sobra efectivo: solo se puede retirar lo esperado ({fmt(plan.withdrawal)}). El resto se queda en el cajón.
                  </p>
                )}
                {plan.withdrawal > 0 && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Al cerrar se apunta como «Retirada al banco» y la caja se cierra con {fmt(plan.keep)}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 4 && doc && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-primary">
              <CheckCircle2 className="h-4 w-4" /> Caja cerrada
            </p>
            <div className="space-y-1 rounded-lg border p-3">
              <Line label="Esperado en el cajón" value={doc.expected === null ? '—' : fmt(doc.expected)} />
              <Line label="Contado" value={fmt(doc.countedTotal)} />
              <Line
                label="Diferencia"
                value={doc.difference === null ? '—' : cashOutcome(doc.difference, 0).text}
                strong
                tone={doc.difference !== null && Math.abs(doc.difference) >= 0.005 ? 'bad' : 'ok'}
              />
              <Line label="Retirado al banco" value={fmt(doc.withdrawal)} />
              <Line label="Queda en caja para mañana" value={fmt(doc.keep)} strong />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step > 1 && step < 4 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => (s - 1) as Step)} disabled={isWorking}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Atrás
            </Button>
          )}
          {step === 1 && (
            <Button type="button" onClick={() => setStep(2)}>Siguiente: contar el efectivo</Button>
          )}
          {step === 2 && (
            <Button type="button" onClick={() => setStep(3)} disabled={!canCount}>Siguiente</Button>
          )}
          {step === 3 && (
            <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={!canClose}>
              {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
              Cerrar caja
            </Button>
          )}
          {step === 4 && doc && (
            <>
              <Button type="button" variant="outline" onClick={() => onPrint(doc)}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir cierre
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>Hecho</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'ok' | 'bad' }) {
  return (
    <div className={cn('flex justify-between', strong && 'font-semibold', tone === 'bad' && 'text-destructive', tone === 'ok' && strong && 'text-primary')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
