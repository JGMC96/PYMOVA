import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';

interface Plan { id: string; name: string; key: string; }
interface Row {
  id: string;
  business_id: string;
  business_name: string;
  plan_id: string;
  plan_name: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
}
const STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;

/** Cambio pendiente de confirmar con un motivo. */
interface PendingChange {
  row: Row;
  summary: string;
  args: { _plan_key?: string; _status?: string; _trial_ends_at?: string };
}

export default function AdminSubscriptions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setRows(null);
    const [{ data: subs, error }, { data: plansData }, { data: businesses }] = await Promise.all([
      supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
      supabase.from('plans').select('id, name, key').order('display_order'),
      supabase.from('businesses').select('id, name'),
    ]);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    setPlans(plansData ?? []);
    const planMap = new Map((plansData ?? []).map(p => [p.id, p.name]));
    const bizMap = new Map((businesses ?? []).map(b => [b.id, b.name]));

    setRows((subs ?? []).map(s => ({
      id: s.id,
      business_id: s.business_id,
      business_name: bizMap.get(s.business_id) ?? '—',
      plan_id: s.plan_id,
      plan_name: planMap.get(s.plan_id) ?? '—',
      status: s.status,
      trial_ends_at: s.trial_ends_at,
      current_period_end: s.current_period_end,
    })));
  };

  useEffect(() => { load(); }, []);

  const askReason = (change: PendingChange) => {
    setReason('');
    setPending(change);
  };

  const changePlan = (row: Row, planId: string) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan || plan.id === row.plan_id) return;
    askReason({ row, summary: `Plan: ${row.plan_name} → ${plan.name}`, args: { _plan_key: plan.key } });
  };

  const changeStatus = (row: Row, status: string) => {
    if (status === row.status) return;
    askReason({ row, summary: `Estado: ${row.status} → ${status}`, args: { _status: status } });
  };

  const extendTrial = (row: Row) => {
    const base = row.trial_ends_at ? new Date(row.trial_ends_at) : new Date();
    base.setDate(base.getDate() + 14);
    askReason({
      row,
      summary: `Prueba ampliada 14 días, hasta el ${base.toLocaleDateString('es-ES')}`,
      args: { _trial_ends_at: base.toISOString(), _status: 'trialing' },
    });
  };

  const confirm = async () => {
    if (!pending || reason.trim().length < 3) return;
    setSaving(true);
    // La RPC valida, pide el motivo y deja la acción en la auditoría.
    const { error } = await supabase.rpc('admin_update_subscription', {
      _business_id: pending.row.business_id,
      _reason: reason.trim(),
      ...pending.args,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Suscripción actualizada', description: pending.summary });
    setPending(null);
    load();
  };

  const statusColor = (s: string) =>
    s === 'active' ? 'default' :
    s === 'trialing' ? 'secondary' :
    s === 'past_due' ? 'destructive' : 'outline';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Suscripciones</h2>
        <p className="text-muted-foreground">
          Gestiona planes y estado de cada negocio. Cada cambio pide un motivo y queda en Actividad.
        </p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Negocio</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fin de prueba</TableHead>
              <TableHead>Fin de periodo</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows && Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {rows && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay suscripciones.
                </TableCell>
              </TableRow>
            )}
            {(rows ?? []).map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.business_name}
                  <div className="text-xs text-muted-foreground font-mono">{r.business_id.slice(0, 8)}</div>
                </TableCell>
                <TableCell>
                  <Select value={r.plan_id} onValueChange={v => changePlan(r, v)}>
                    <SelectTrigger className="w-36" aria-label={`Plan de ${r.business_name}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={r.status} onValueChange={v => changeStatus(r, v)}>
                    <SelectTrigger className="w-32" aria-label={`Estado de ${r.business_name}`}>
                      <SelectValue>
                        <Badge variant={statusColor(r.status) as never}>{r.status}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.current_period_end ? new Date(r.current_period_end).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => extendTrial(r)}>
                    +14 días prueba
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar cambio de suscripción</DialogTitle>
            <DialogDescription>
              {pending?.row.business_name}: {pending?.summary}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo (obligatorio)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Por ejemplo: cliente piloto, pago recibido fuera de la plataforma…"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Quedará registrado en Actividad junto con tu usuario.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={confirm} disabled={saving || reason.trim().length < 3}>
              {saving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
