import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { actionLabel, changedFields, formatValue, type PlatformAuditEntry } from '@/lib/adminActivity';

const PAGE_SIZE = 50;
const TODOS = '__todos__';

async function fetchActivity(limit: number, businessId: string | null): Promise<PlatformAuditEntry[]> {
  const { data, error } = await supabase.rpc('get_platform_audit_log', {
    _limit: limit,
    _offset: 0,
    _business_id: businessId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAuditEntry[];
}

async function fetchBusinesses(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('businesses').select('id, name').order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default function AdminActivity() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const businesses = useQuery({ queryKey: ['admin', 'businesses'], queryFn: fetchBusinesses });
  const activity = useQuery({
    queryKey: ['admin', 'activity', businessId, limit],
    queryFn: () => fetchActivity(limit, businessId),
  });

  const entries = activity.data ?? [];
  const hasMore = entries.length >= limit && limit < 200;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Actividad</h2>
          <p className="text-muted-foreground">
            Acciones de super admin: suscripciones, módulos, roles de plataforma y negocios.
          </p>
        </div>
        <Select
          value={businessId ?? TODOS}
          onValueChange={v => { setBusinessId(v === TODOS ? null : v); setLimit(PAGE_SIZE); }}
        >
          <SelectTrigger className="w-64" aria-label="Filtrar por negocio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los negocios</SelectItem>
            {(businesses.data ?? []).map(b => (
              <SelectItem key={b.id} value={b.id}>
                {b.name} <span className="font-mono text-xs text-muted-foreground">{b.id.slice(0, 8)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activity.error && (
        <p className="text-sm text-destructive">{(activity.error as Error).message}</p>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Quién</TableHead>
              <TableHead>Qué</TableHead>
              <TableHead>Negocio</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activity.isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!activity.isLoading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Sin actividad registrada.
                </TableCell>
              </TableRow>
            )}
            {entries.map(e => {
              const cambios = changedFields(e);
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(e.created_at).toLocaleString('es-ES')}
                  </TableCell>
                  <TableCell className="text-sm">{e.actor_email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={e.action === 'DELETE' ? 'destructive' : 'secondary'}>{actionLabel(e)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.business_name ?? '—'}
                    {e.business_id && (
                      <div className="text-xs text-muted-foreground font-mono">{e.business_id.slice(0, 8)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm max-w-xs">{e.reason ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-sm">
                    {cambios.slice(0, 4).map(c => (
                      <div key={c.field}>
                        <span className="font-mono">{c.field}</span>
                        {e.action === 'UPDATE'
                          ? <>: {formatValue(c.before)} → {formatValue(c.after)}</>
                          : <>: {formatValue(e.action === 'DELETE' ? c.before : c.after)}</>}
                      </div>
                    ))}
                    {cambios.length > 4 && <div>… y {cambios.length - 4} más</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit(l => Math.min(l + PAGE_SIZE, 200))} disabled={activity.isFetching}>
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}
