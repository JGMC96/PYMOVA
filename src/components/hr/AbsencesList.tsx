import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { AbsenceTypeBadge, AbsenceStatusBadge } from './AbsenceBadge';
import { useAbsences, type AbsenceFilters } from '@/hooks/useAbsences';
import type { AbsenceStatus, AbsenceType } from '@/types/database';

interface Props {
  scope: 'mine' | 'team';
  canReview?: boolean;
}

export function AbsencesList({ scope, canReview }: Props) {
  const { absences, filters, setFilters, reviewAbsence, isLoading } = useAbsences({
    scope,
    status: 'all',
    type: 'all',
  });

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
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
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.type || 'all'}
            onValueChange={(v) => setFilters({ ...filters, type: v as AbsenceType | 'all' })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="vacation">Vacaciones</SelectItem>
              <SelectItem value="sick_leave">Baja médica</SelectItem>
              <SelectItem value="personal">Asuntos propios</SelectItem>
              <SelectItem value="other">Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando...</p>
        ) : absences.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No hay solicitudes</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {scope === 'team' && <TableHead>Empleado</TableHead>}
                <TableHead>Tipo</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead>Hasta</TableHead>
                <TableHead>Días</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                {canReview && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {absences.map((a) => (
                <TableRow key={a.id}>
                  {scope === 'team' && (
                    <TableCell className="font-medium">{a.employee_name || '—'}</TableCell>
                  )}
                  <TableCell>
                    <AbsenceTypeBadge type={a.absence_type} label={a.custom_type_label} />
                  </TableCell>
                  <TableCell>{format(new Date(a.start_date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>{format(new Date(a.end_date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell className="font-semibold">{a.days_count}</TableCell>
                  <TableCell>
                    <AbsenceStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {a.reason || '—'}
                  </TableCell>
                  {canReview && (
                    <TableCell className="text-right">
                      {a.status === 'pending' && (
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onClick={() => reviewAbsence(a.id, true)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                            onClick={() => reviewAbsence(a.id, false)}
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
