import { useState } from 'react';
import { Wallet, Lock, Unlock, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useCashRegister } from '@/hooks/useCashRegister';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';
import { cn } from '@/lib/utils';

const fmt = (n: number | null | undefined) => `${(n ?? 0).toFixed(2)} €`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function CashRegisterPanel() {
  const {
    openSession, history, summary, expectedCash, isLoading, isWorking,
    openRegister, closeRegister, refresh,
  } = useCashRegister();

  const [openingAmount, setOpeningAmount] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [notes, setNotes] = useState('');

  const counted = parseFloat(countedAmount);
  const difference = !isNaN(counted) ? counted - expectedCash : null;
  const salesTotal = summary.reduce((s, r) => s + Number(r.total_amount), 0);
  const salesCount = summary.reduce((s, r) => s + Number(r.sales_count), 0);

  const handleOpen = async () => {
    const ok = await openRegister(parseFloat(openingAmount) || 0);
    if (ok) setOpeningAmount('');
  };

  const handleClose = async () => {
    if (isNaN(counted)) return;
    const ok = await closeRegister(counted, notes);
    if (ok) {
      setCountedAmount('');
      setNotes('');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                  ? `Abierta el ${fmtDate(openSession.opened_at)}`
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
                <div>
                  <Label htmlFor="opening">Fondo inicial de caja</Label>
                  <Input
                    id="opening"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={openingAmount}
                    onChange={(e) => setOpeningAmount(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleOpen} disabled={isWorking}>
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
                      {salesCount} · {fmt(salesTotal)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Efectivo esperado</span>
                    <span className="text-primary">{fmt(expectedCash)}</span>
                  </div>
                </div>

                <Separator />

                <div>
                  <Label htmlFor="counted">Efectivo contado</Label>
                  <Input
                    id="counted"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={countedAmount}
                    onChange={(e) => setCountedAmount(e.target.value)}
                  />
                </div>

                {difference !== null && (
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm font-medium flex justify-between',
                      Math.abs(difference) < 0.01
                        ? 'bg-primary/10 text-primary'
                        : 'bg-destructive/10 text-destructive'
                    )}
                  >
                    <span>Diferencia</span>
                    <span>{fmt(difference)}</span>
                  </div>
                )}

                <div>
                  <Label htmlFor="notes">Notas del arqueo</Label>
                  <Textarea
                    id="notes"
                    rows={2}
                    placeholder="Incidencias, retiradas de efectivo..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <Button
                  className="w-full"
                  variant="destructive"
                  onClick={handleClose}
                  disabled={isWorking || isNaN(counted)}
                >
                  <Lock className="w-4 h-4 mr-2" />
                  Cerrar caja
                </Button>
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
                        {fmt(Number(row.total_amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-center font-semibold">{salesCount}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {fmt(salesTotal)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

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
                  <TableHead className="text-right">Fondo</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{fmtDate(s.opened_at)}</TableCell>
                    <TableCell>{fmtDate(s.closed_at)}</TableCell>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
