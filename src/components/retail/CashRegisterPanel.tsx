import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, Lock, Unlock, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useCashMovements } from '@/hooks/useCashMovements';
import { useCashRegister } from '@/hooks/useCashRegister';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { movementTotals } from '@/lib/cashMovements';
import { parseCash, suggestedOpening, type ClosingDoc } from '@/lib/cierreCaja';
import { printClosing } from '@/lib/ticket';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';
import { cn } from '@/lib/utils';
import { CashMovementsCard, ClosedSessionMovementsDialog } from './CashMovements';
import { CashRegisterStaleBanner } from './CashRegisterStaleBanner';
import { CloseRegisterDialog, type CloseRequest } from './CloseRegisterDialog';

const fmt = (n: number | null | undefined) => `${(n ?? 0).toFixed(2)} €`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function CashRegisterPanel() {
  const { sellers, employees, requiresSeller, chooseSeller, can, authorize, dropSession } = useSellerSession();
  const { isAdmin } = useRoleAccess('admin');
  const {
    openSession, history, summary, bySeller, expectedCash: expectedBeforeMovements, cashRefunds, isBlind, isLoading, isWorking,
    openRegister, closeRegister, refresh: refreshRegister,
  } = useCashRegister(sellers.map((s) => s.sessionId));
  const {
    movements, isSaving: isSavingMovement, refresh: refreshMovements, createMovement, voidMovement,
  } = useCashMovements(openSession?.id);
  const { business: ticketBusiness, prefs: ticketPrefs } = useTicketConfig();
  const totals = movementTotals(movements);
  const expectedCash = Math.round((expectedBeforeMovements + totals.net) * 100) / 100;
  const [movementsOf, setMovementsOf] = useState<string | null>(null);
  const closeMovementsOf = useCallback(() => setMovementsOf(null), []);
  const refresh = () => {
    void refreshRegister();
    void refreshMovements();
  };
  const personName = (id: string | null | undefined) =>
    id ? employees.find((e) => e.id === id)?.name ?? '—' : '—';

  const [openingAmount, setOpeningAmount] = useState('');
  const [openingTouched, setOpeningTouched] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  // Retirada ya apuntada en un intento de cierre que falló: al reintentar, solo se cierra.
  const withdrawnRef = useRef<{ sessionId: string; amount: number } | null>(null);

  // Lo que quedó en el cajón en el último cierre: es el fondo que se propone al abrir.
  const lastKeep = suggestedOpening(history[0]);
  useEffect(() => {
    if (!openSession && !openingTouched && lastKeep !== null) setOpeningAmount(lastKeep.toFixed(2).replace('.', ','));
  }, [openSession, openingTouched, lastKeep]);
  const openingValue = parseCash(openingAmount);
  const openingDiffers = lastKeep !== null && openingValue !== null && Math.abs(openingValue - lastKeep) >= 0.005;
  const salesTotal = summary.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  // Ventas del turno: cada venta una vez. El resumen por forma de pago cuenta dos veces una venta
  // mixta (o con vale y otra forma); el de por vendedor, no (0065).
  const salesCount = bySeller.length > 0
    ? bySeller.reduce((s, r) => s + Number(r.sales_count), 0)
    : summary.reduce((s, r) => s + Number(r.sales_count), 0);

  const handleOpen = async () => {
    // Con dependientes con PIN, abre una persona identificada (0033).
    const pick = await chooseSeller('la apertura de caja');
    if (pick.cancelled) return;
    const ok = await openRegister(openingValue ?? 0, {
      sellerSessionId: pick.seller?.sessionId ?? null,
    });
    if (!ok && pick.seller) dropSession(pick.seller.sessionId);
    if (ok) {
      setOpeningAmount('');
      setOpeningTouched(false);
    }
  };

  /**
   * Paso final del asistente: primero los PIN (cierre y, si se retira algo, la retirada), después
   * la «Retirada al banco» y por último el cierre con lo que queda en el cajón como contado. La
   * diferencia es la misma que si se cerrara con todo lo contado.
   */
  const handleClose = async (req: CloseRequest): Promise<boolean> => {
    if (!openSession) return false;
    const sessionId = openSession.id;
    const already = withdrawnRef.current?.sessionId === sessionId ? withdrawnRef.current.amount : 0;
    const toWithdraw = Math.round((req.withdrawal - already) * 100) / 100;

    // Cierra una persona identificada; sin permiso, lo autoriza un encargado (0030).
    const pick = await chooseSeller('el cierre de caja');
    if (pick.cancelled) return false;
    let authorizationId: string | null = null;
    if (!can(pick.seller, 'close_register')) {
      authorizationId = await authorize('close_register', 'el cierre de caja');
      if (!authorizationId) return false;
    }
    let movementAuth: string | null = null;
    if (toWithdraw > 0 && requiresSeller) {
      movementAuth = await authorize('cash_movement', 'la retirada al banco del cierre');
      if (!movementAuth) {
        if (pick.seller) dropSession(pick.seller.sessionId);
        return false;
      }
    }
    if (toWithdraw > 0) {
      const saved = await createMovement({
        type: 'withdrawal',
        amount: toWithdraw,
        category: null,
        reason: 'Retirada al cerrar la caja',
        authorizationId: movementAuth,
      });
      if (!saved) {
        if (pick.seller) dropSession(pick.seller.sessionId);
        return false;
      }
      withdrawnRef.current = { sessionId, amount: already + toWithdraw };
    }
    const ok = await closeRegister(req.keep, req.notes, {
      sellerSessionId: pick.seller?.sessionId ?? null,
      authorizationId,
    });
    if (!ok) {
      if (pick.seller) dropSession(pick.seller.sessionId);
      return false;
    }
    withdrawnRef.current = null;
    setClosingId(sessionId);
    return true;
  };

  const printClosingDoc = (doc: ClosingDoc) => printClosing(ticketBusiness, doc, ticketPrefs);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {openSession && <CashRegisterStaleBanner openedAt={openSession.opened_at} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Caja {openSession ? 'abierta' : 'cerrada'}
              </CardTitle>
              <CardDescription>
                {openSession
                  ? `Abierta el ${fmtDate(openSession.opened_at)}${
                      openSession.opened_by_employee_id ? ` por ${personName(openSession.opened_by_employee_id)}` : ''
                    }`
                  : 'Abre la caja al empezar el turno para poder cuadrarla al cerrar.'}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!openSession ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="opening">Fondo inicial: el efectivo que hay ahora en el cajón</Label>
                  <Input
                    id="opening"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={openingAmount}
                    onChange={(e) => {
                      setOpeningTouched(true);
                      setOpeningAmount(e.target.value);
                    }}
                  />
                  {lastKeep !== null && (
                    <p className={cn('text-xs', openingDiffers ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                      {openingDiffers
                        ? `Ojo: en el último cierre quedaron ${fmt(lastKeep)} en el cajón. Si ahora hay otra cantidad, cuéntala bien antes de abrir.`
                        : `Es lo que quedó en el cajón en el último cierre (${fmt(lastKeep)}).`}
                    </p>
                  )}
                </div>
                <Button className="w-full" onClick={handleOpen} disabled={isWorking || openingValue === null}>
                  <Unlock className="w-4 h-4 mr-2" />
                  Abrir caja
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fondo inicial</span>
                    <span>{fmt(openSession.opening_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ventas del turno</span>
                    <span>
                      {salesCount}
                      {isBlind ? '' : ` · ${fmt(salesTotal)}`}
                    </span>
                  </div>
                  {!isBlind && cashRefunds > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Devoluciones en efectivo</span>
                      <span className="text-destructive">−{fmt(cashRefunds)}</span>
                    </div>
                  )}
                  {!isBlind && totals.cashIn > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Entradas de cambio</span>
                      <span>+{fmt(totals.cashIn)}</span>
                    </div>
                  )}
                  {!isBlind && totals.expenses > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gastos</span>
                      <span className="text-destructive">−{fmt(totals.expenses)}</span>
                    </div>
                  )}
                  {!isBlind && totals.withdrawals > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Retiradas al banco</span>
                      <span className="text-destructive">−{fmt(totals.withdrawals)}</span>
                    </div>
                  )}
                  <Separator />
                  {isBlind ? (
                    <p className="text-muted-foreground">
                      Arqueo a ciegas: cuenta el efectivo y ciérrala. El esperado y la diferencia se ven al cerrar, o
                      si se conecta alguien que puede cerrar la caja.
                    </p>
                  ) : (
                    <div className="flex justify-between font-semibold">
                      <span>Efectivo esperado</span>
                      <span className="text-primary">{fmt(expectedCash)}</span>
                    </div>
                  )}
                </div>

                <Button className="w-full" variant="destructive" onClick={() => setCloseOpen(true)} disabled={isWorking}>
                  <Lock className="w-4 h-4 mr-2" />
                  Cerrar caja
                </Button>
                <p className="text-xs text-muted-foreground">
                  Te guía en 3 pasos: repasar el turno, contar el efectivo y decidir cuánto dejas para mañana.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Desglose por método de pago</CardTitle>
            <CardDescription>Turno en curso</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">
                Todavía no hay ventas en este turno
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-center">Ventas</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((row) => (
                    <TableRow key={row.payment_method}>
                      <TableCell>
                        <Badge variant="outline">
                          {PAYMENT_LABELS[row.payment_method] ?? row.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{row.sales_count}</TableCell>
                      <TableCell className="text-right font-medium">
                        {row.total_amount === null ? '—' : fmt(Number(row.total_amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-center font-semibold">{salesCount}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {isBlind ? '—' : fmt(salesTotal)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {openSession && (
        <CashMovementsCard
          movements={movements}
          canMove={requiresSeller || isAdmin}
          isSaving={isSavingMovement}
          onCreate={createMovement}
          onVoid={voidMovement}
        />
      )}

      {openSession && bySeller.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Turno por vendedor</CardTitle>
            <CardDescription>
              {isBlind
                ? 'Arqueo a ciegas: los importes se ven al cerrar o si se conecta alguien que puede cerrar la caja.'
                : 'Ventas y devoluciones de cada persona en esta caja.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-center">Ventas</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">En efectivo</TableHead>
                  <TableHead className="text-center">Devoluciones</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySeller.map((r) => (
                  <TableRow key={r.employee_id ?? 'none'}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-center">{r.sales_count}</TableCell>
                    <TableCell className="text-right">{r.sales_total === null ? '—' : fmt(Number(r.sales_total))}</TableCell>
                    <TableCell className="text-right">{r.cash_total === null ? '—' : fmt(Number(r.cash_total))}</TableCell>
                    <TableCell className="text-center">
                      {r.refunds_count}
                      {r.refunds_total === null || r.refunds_count === 0 ? '' : ` · −${fmt(Number(r.refunds_total))}`}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {r.net_total === null ? '—' : fmt(Number(r.net_total))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial de cierres</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6 text-center">
              Aún no hay cierres registrados
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Apertura</TableHead>
                  <TableHead>Cierre</TableHead>
                  <TableHead>Abrió</TableHead>
                  <TableHead>Cerró</TableHead>
                  <TableHead className="text-right">Fondo</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead><span className="sr-only">Movimientos</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{fmtDate(s.opened_at)}</TableCell>
                    <TableCell>{fmtDate(s.closed_at)}</TableCell>
                    <TableCell>{personName(s.opened_by_employee_id)}</TableCell>
                    <TableCell>
                      {personName(s.closed_by_employee_id)}
                      {s.close_authorized_by_employee_id && (
                        <span className="block text-xs text-muted-foreground">
                          Autorizó {personName(s.close_authorized_by_employee_id)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmt(s.opening_amount)}</TableCell>
                    <TableCell className="text-right">{fmt(s.expected_amount)}</TableCell>
                    <TableCell className="text-right">{fmt(s.counted_amount)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium',
                        Math.abs(s.difference ?? 0) < 0.01 ? 'text-muted-foreground' : 'text-destructive'
                      )}
                    >
                      {fmt(s.difference)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setMovementsOf(s.id)}>
                        Movimientos
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ClosedSessionMovementsDialog sessionId={movementsOf} onClose={closeMovementsOf} />
      <CloseRegisterDialog
        open={closeOpen}
        onOpenChange={(o) => {
          setCloseOpen(o);
          if (!o) setClosingId(null);
        }}
        session={openSession}
        summary={summary}
        isBlind={isBlind}
        cashRefunds={cashRefunds}
        movements={totals}
        defaultKeep={Number(openSession?.opening_amount ?? 0) > 0 ? Number(openSession?.opening_amount) : lastKeep ?? 0}
        isWorking={isWorking || isSavingMovement}
        closedSession={closingId ? history.find((s) => s.id === closingId) ?? null : null}
        personName={personName}
        onConfirm={handleClose}
        onPrint={printClosingDoc}
      />
    </div>
  );
}
