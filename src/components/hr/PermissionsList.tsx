import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { AbsenceStatusBadge } from './AbsenceBadge';
import { PermissionTypeBadge } from './PermissionTypeBadge';
import { usePermissions } from '@/hooks/usePermissions';
import type { AbsenceStatus, PermissionType } from '@/types/database';

interface Props {
  scope: 'mine' | 'team';
  canReview?: boolean;
}

export function PermissionsList({ scope, canReview }: Props) {
  const { permissions, filters, setFilters, reviewPermission, isLoading } = usePermissions({
    scope,
    status: 'all',
    type: 'all',
  });

  const totalHours = permissions
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + Number(p.hours_count || 0), 0);

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => setFilters({ ...filters, status: v as AbsenceStatus | 'all' })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="approved">Aprobada</SelectItem>
              <SelectItem value="rejected">Rechazada</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.type || 'all'}
            onValueChange={(v) => setFilters({ ...filters, type: v as PermissionType | 'all' })}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="late_arrival">Llegada tarde</SelectItem>
              <SelectItem value="early_departure">Salida anticipada</SelectItem>
              <SelectItem value="personal_errand">Gestión personal</SelectItem>
              <SelectItem value="other">Otro</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm text-muted-foreground">
            Horas aprobadas: <span className="font-semibold text-foreground">{totalHours.toFixed(2)}h</span>
          </div>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando...</p>
        ) : permissions.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No hay permisos</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {scope === 'team' && <TableHead>Empleado</TableHead>}
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Horario</TableHead>
                <TableHead>Horas</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                {canReview && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissions.map((p) => (
                <TableRow key={p.id}>
                  {scope === 'team' && <TableCell className="font-medium">{p.employee_name || '—'}</TableCell>}
                  <TableCell>
                    <PermissionTypeBadge type={p.permission_type} label={p.custom_type_label} />
                  </TableCell>
                  <TableCell>{format(new Date(p.permission_date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {p.start_time.slice(0, 5)} – {p.end_time.slice(0, 5)}
                  </TableCell>
                  <TableCell className="font-semibold">{Number(p.hours_count).toFixed(2)}h</TableCell>
                  <TableCell>
                    <AbsenceStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {p.reason || '—'}
                  </TableCell>
                  {canReview && (
                    <TableCell className="text-right">
                      {p.status === 'pending' && (
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onClick={() => reviewPermission(p.id, true)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                            onClick={() => reviewPermission(p.id, false)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
