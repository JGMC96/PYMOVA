import { useEffect, useState } from 'react';
import { ArrowLeftRight, Ban, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { fetchCashMovements, type NewCashMovement } from '@/hooks/useCashMovements';
import {
  EXPENSE_CATEGORIES, MOVEMENT_LABELS, movementProblem, parseMovementAmount, reasonProblem,
  type CashMovement, type CashMovementType,
} from '@/lib/cashMovements';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `${n.toFixed(2)} €`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const signed = (m: CashMovement) => `${m.movement_type === 'cash_in' ? '+' : '−'}${fmt(Number(m.amount))}`;

/** Con dependientes con PIN, cada movimiento lleva el de alguien que pueda cerrar la caja. */
function useMovementAuthorization() {
  const { requiresSeller, authorize } = useSellerSession();
  return async (): Promise<{ cancelled: boolean; authorizationId: string | null }> => {
    if (!requiresSeller) return { cancelled: false, authorizationId: null };
    const authorizationId = await authorize('cash_movement', 'el movimiento de caja');
    return { cancelled: !authorizationId, authorizationId };
  };
}

function MovementsTable({ movements, onVoid }: { movements: CashMovement[]; onVoid?: (m: CashMovement) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Hora</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead>Quién</TableHead>
          <TableHead className="text-right">Importe</TableHead>
          {onVoid && <TableHead className="w-10"><span className="sr-only">Anular</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {movements.map((m) => (
          <TableRow key={m.id} className={cn(m.voided_at && 'text-muted-foreground')}>
            <TableCell className="whitespace-nowrap">{fmtDate(m.created_at)}</TableCell>
            <TableCell>
              <Badge variant="outline" className="whitespace-nowrap">{MOVEMENT_LABELS[m.movement_type]}</Badge>
              {m.category && (
                <span className="block text-xs text-muted-foreground mt-1">{EXPENSE_CATEGORIES[m.category] ?? m.category}</span>
              )}
            </TableCell>
            <TableCell>
              <span className={cn(m.voided_at && 'line-through')}>{m.reason}</span>
              {m.voided_at && (
                <span className="block text-xs">
                  Anulado por {m.voided_who ?? '—'}: {m.void_reason}
                </span>
              )}
            </TableCell>
            <TableCell>{m.who ?? '—'}</TableCell>
            <TableCell className={cn('text-right font-medium whitespace-nowrap', m.voided_at && 'line-through')}>
              {signed(m)}
            </TableCell>
            {onVoid && (
              <TableCell>
                {!m.voided_at && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Anular este movimiento"
                    aria-label={`Anular ${m.reason}`}
                    onClick={() => onVoid(m)}
                  >
                    <Ban className="w-4 h-4" />
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function NewMovementDialog({
  open, onOpenChange, isSaving, onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onSave: (m: NewCashMovement) => Promise<boolean>;
}) {
  const authorizeMovement = useMovementAuthorization();
  const [type, setType] = useState<CashMovementType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const problem = movementProblem(type, amount, category, reason);

  useEffect(() => {
    if (!open) return;
    setType('expense');
    setAmount('');
    setCategory('');
    setReason('');
  }, [open]);

  const save = async () => {
    const value = parseMovementAmount(amount);
    if (problem || value === null) return;
    const { cancelled, authorizationId } = await authorizeMovement();
    if (cancelled) return;
    const ok = await onSave({
      type,
      amount: value,
      category: type === 'expense' ? category : null,
      reason: reason.trim(),
      authorizationId,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento de caja</DialogTitle>
          <DialogDescription>Dinero que entra o sale del cajón sin ser una venta. El arqueo lo tiene en cuenta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="movement-type">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as CashMovementType)}>
                <SelectTrigger id="movement-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MOVEMENT_LABELS) as CashMovementType[]).map((t) => (
                    <SelectItem key={t} value={t}>{MOVEMENT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-amount">Importe (€)</Label>
              <Input
                id="movement-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {type === 'expense' && (
            <div className="space-y-1.5">
              <Label htmlFor="movement-category">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="movement-category"><SelectValue placeholder="Elige una" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPENSE_CATEGORIES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="movement-reason">Motivo</Label>
            <Input
              id="movement-reason"
              maxLength={200}
              placeholder={type === 'expense' ? 'Garrafas de agua' : type === 'cash_in' ? 'Cambio del banco' : 'Ingreso en el banco'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={!!problem || isSaving}>Apuntar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidMovementDialog({
  movement, onClose, isSaving, onVoid,
}: {
  movement: CashMovement | null;
  onClose: () => void;
  isSaving: boolean;
  onVoid: (id: string, reason: string, authorizationId: string | null) => Promise<boolean>;
}) {
  const authorizeMovement = useMovementAuthorization();
  const [reason, setReason] = useState('');
  const problem = reasonProblem(reason);

  useEffect(() => {
    if (movement) setReason('');
  }, [movement]);

  const confirm = async () => {
    if (!movement || problem) return;
    const { cancelled, authorizationId } = await authorizeMovement();
    if (cancelled) return;
    if (await onVoid(movement.id, reason.trim(), authorizationId)) onClose();
  };

  return (
    <Dialog open={!!movement} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular movimiento</DialogTitle>
          <DialogDescription>
            {movement && `${MOVEMENT_LABELS[movement.movement_type]} de ${fmt(Number(movement.amount))}: ${movement.reason}. `}
            Deja de contar en el arqueo, pero sigue en la lista con el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Motivo de la anulación</Label>
          <Input id="void-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={!!problem || isSaving}>Anular</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Movimientos del turno en curso, en la pantalla de Caja. */
export function CashMovementsCard({
  movements, canMove, isSaving, onCreate, onVoid,
}: {
  movements: CashMovement[];
  canMove: boolean;
  isSaving: boolean;
  onCreate: (m: NewCashMovement) => Promise<boolean>;
  onVoid: (id: string, reason: string, authorizationId: string | null) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<CashMovement | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            Movimientos de caja
          </CardTitle>
          <CardDescription>Gastos, entradas de cambio y retiradas al banco de este turno.</CardDescription>
        </div>
        {canMove && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo movimiento
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm py-6 text-center">Todavía no hay movimientos en este turno</p>
        ) : (
          <MovementsTable movements={movements} onVoid={canMove ? setVoiding : undefined} />
        )}
      </CardContent>
      <NewMovementDialog open={creating} onOpenChange={setCreating} isSaving={isSaving} onSave={onCreate} />
      <VoidMovementDialog movement={voiding} onClose={() => setVoiding(null)} isSaving={isSaving} onVoid={onVoid} />
    </Card>
  );
}

/** Movimientos de una caja ya cerrada, desde el historial de cierres. Solo lectura. */
export function ClosedSessionMovementsDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const [movements, setMovements] = useState<CashMovement[] | null>(null);

  useEffect(() => {
    setMovements(null);
    if (!sessionId) return;
    let cancelled = false;
    fetchCashMovements(sessionId)
      .then((list) => {
        if (!cancelled) setMovements(list);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Error al cargar los movimientos de caja');
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, onClose]);

  return (
    <Dialog open={!!sessionId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Movimientos de esta caja</DialogTitle>
        </DialogHeader>
        {movements === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : movements.length === 0 ? (
          <p className="text-muted-foreground text-sm py-6 text-center">Esta caja no tuvo movimientos</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <MovementsTable movements={movements} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
