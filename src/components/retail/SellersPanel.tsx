import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSellers, type SellerReportRow } from '@/hooks/useSellers';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { isValidPin, SELLER_SESSION_HOURS, type PosEmployee } from '@/lib/sellerSession';

const eur = (n: number) => `${n.toFixed(2)} €`;
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

type PinTarget = { id: string; name: string } | null;
type NameTarget = { id: string | null; name: string } | null;

/** Pestaña «Vendedores» (admins): dependientes del TPV; las ventas por vendedor, solo el propietario. */
export function SellersPanel() {
  const { isOwner } = useRoleAccess('owner');
  const { employees, isLoading, isSaving, myEmployee, createEmployee, renameEmployee, setActive, setPin, ensureMyEmployee, salesBySeller, refresh } =
    useSellers();
  const [pinTarget, setPinTarget] = useState<PinTarget>(null);
  const [nameTarget, setNameTarget] = useState<NameTarget>(null);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<SellerReportRow[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  const loadReport = useCallback(async () => {
    if (!isOwner) return;
    setLoadingReport(true);
    setReport(await salesBySeller(from, to));
    setLoadingReport(false);
  }, [salesBySeller, from, to, isOwner]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Dependientes
            </CardTitle>
            <CardDescription>
              Con algún dependiente con PIN, nadie cobra ni devuelve sin identificarse. Al cobrar, el TPV pide el PIN
              si no hay nadie conectado, usa a la persona conectada si solo hay una y pregunta quién ha hecho la venta
              si hay varias. Quien mete su PIN queda conectado {SELLER_SESSION_HOURS} horas. No necesitan cuenta ni
              correo, y cada uno puede cambiar su PIN en el TPV.
            </CardDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={() => setNameTarget({ id: null, name: '' })}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo dependiente
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!myEmployee && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
              <UserRound className="w-4 h-4 text-primary" />
              <span>Tú todavía no apareces como vendedor.</span>
              <Button variant="outline" size="sm" onClick={() => void ensureMyEmployee()} disabled={isSaving}>
                Añadirme
              </Button>
            </div>
          )}
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : employees.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay dependientes.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Acceso</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <EmployeeRow
                    key={e.id}
                    employee={e}
                    busy={isSaving}
                    onPin={() => setPinTarget({ id: e.id, name: e.name })}
                    onRename={() => setNameTarget({ id: e.id, name: e.name })}
                    onActive={(v) => void setActive(e.id, v)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isOwner && (
      <Card>
        <CardHeader>
          <CardTitle>Ventas por vendedor</CardTitle>
          <CardDescription>Ventas y devoluciones por fecha del negocio. Las devoluciones se atribuyen a quien las hizo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="sellers-from">Desde</Label>
              <Input id="sellers-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sellers-to">Hasta</Label>
              <Input id="sellers-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => void loadReport()} disabled={loadingReport}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Actualizar
            </Button>
          </div>
          {report.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {loadingReport ? 'Cargando…' : 'Sin ventas en ese periodo.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Vendido</TableHead>
                  <TableHead className="text-right">Devoluciones</TableHead>
                  <TableHead className="text-right">Devuelto</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.map((r) => (
                  <TableRow key={r.employee_id ?? 'none'}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.sales_count}</TableCell>
                    <TableCell className="text-right">{eur(r.sales_total)}</TableCell>
                    <TableCell className="text-right">{r.returns_count}</TableCell>
                    <TableCell className="text-right">{eur(r.returns_total)}</TableCell>
                    <TableCell className="text-right font-semibold">{eur(r.net_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      <PinDialog
        target={pinTarget}
        firstPin={!employees.some((e) => e.has_pin && e.is_active)}
        busy={isSaving}
        onClose={() => setPinTarget(null)}
        onSave={async (pin) => {
          if (pinTarget && (await setPin(pinTarget.id, pin))) setPinTarget(null);
        }}
      />
      <NameDialog
        target={nameTarget}
        busy={isSaving}
        onClose={() => setNameTarget(null)}
        onSave={async (name) => {
          if (!nameTarget) return;
          const ok = nameTarget.id ? await renameEmployee(nameTarget.id, name) : await createEmployee(name);
          if (ok) setNameTarget(null);
        }}
      />
    </div>
  );
}

function EmployeeRow({
  employee: e,
  busy,
  onPin,
  onRename,
  onActive,
}: {
  employee: PosEmployee;
  busy: boolean;
  onPin: () => void;
  onRename: () => void;
  onActive: (active: boolean) => void;
}) {
  return (
    <TableRow className={e.is_active ? undefined : 'opacity-60'}>
      <TableCell className="font-medium">{e.name}</TableCell>
      <TableCell>
        <Badge variant="outline">{e.has_account ? 'Con cuenta' : 'Solo TPV'}</Badge>
      </TableCell>
      <TableCell>{e.has_pin ? <Badge>Sí</Badge> : <Badge variant="secondary">Sin PIN</Badge>}</TableCell>
      <TableCell>
        <Switch checked={e.is_active} onCheckedChange={onActive} disabled={busy} aria-label="Activo" />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onPin} disabled={busy}>
            <KeyRound className="w-4 h-4 mr-1.5" />
            {e.has_pin ? 'Cambiar PIN' : 'Poner PIN'}
          </Button>
          {!e.has_account && (
            <Button variant="ghost" size="sm" onClick={onRename} disabled={busy} aria-label="Renombrar">
              <Pencil className="w-4 h-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PinDialog({
  target,
  firstPin,
  busy,
  onClose,
  onSave,
}: {
  target: PinTarget;
  /** Ningún dependiente activo tiene PIN todavía: este será el primero. */
  firstPin: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  useEffect(() => {
    setPin('');
    setRepeat('');
  }, [target]);
  const valid = isValidPin(pin) && pin === repeat;
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>PIN de {target?.name}</DialogTitle>
          <DialogDescription>De 4 a 6 cifras. Si ya tenía PIN, el nuevo lo sustituye.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pin-new">PIN</Label>
            <Input
              id="pin-new"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin-repeat">Repite el PIN</Label>
            <Input
              id="pin-repeat"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {repeat && pin !== repeat && <p className="text-sm text-destructive">Los dos PIN no coinciden.</p>}
          {firstPin && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400" role="note">
              Es el primer PIN del negocio: desde que lo guardes, el TPV pedirá identificarse para cobrar y devolver.
              Pon el PIN a todos los que venden seguidos, en un momento tranquilo.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave(pin)} disabled={!valid || busy}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({
  target,
  busy,
  onClose,
  onSave,
}: {
  target: NameTarget;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(target?.name ?? '');
  }, [target]);
  const valid = name.trim().length >= 2 && name.trim().length <= 60;
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{target?.id ? 'Renombrar dependiente' : 'Nuevo dependiente'}</DialogTitle>
          <DialogDescription>
            {target?.id ? 'Es el nombre que sale en el ticket y en el historial.' : 'Después ponle un PIN para que pueda identificarse en el TPV.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="seller-name">Nombre</Label>
          <Input
            id="seller-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !busy) void onSave(name.trim());
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave(name.trim())} disabled={!valid || busy}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
