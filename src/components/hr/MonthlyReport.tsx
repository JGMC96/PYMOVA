import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { useHrEmployees } from '@/hooks/useHrEmployees';
import { useHrReports, type MonthlyReportRow } from '@/hooks/useHrReports';
import {
  buildMonthlyCsv,
  downloadCsv,
  formatSeconds,
  formatSessionDate,
  monthName,
  monthlyTotals,
  reportYears,
} from '@/lib/hrReport';
import { CorrectSessionDialog } from './CorrectSessionDialog';
import { SessionStatusBadge } from './SessionStatusBadge';

export function MonthlyReport() {
  const { employees } = useHrEmployees();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employeeId, setEmployeeId] = useState<string>('');

  const { rows, isLoading, correctSession } = useHrReports(employeeId || null, year, month);
  const [editing, setEditing] = useState<MonthlyReportRow | null>(null);
  const { worked: totalWorked, breaks: totalBreak, pending: pendientes } = monthlyTotals(rows);
  const hasCorrections = rows.some((r) => r.correction_reason);

  const exportCsv = () => {
    downloadCsv(buildMonthlyCsv(rows), `reporte_${year}_${month}.csv`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reporte mensual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Selecciona empleado" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.full_name || e.user_id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)} className="capitalize">{monthName(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {reportYears(now.getFullYear()).map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length} className="gap-2 ml-auto">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>

        {!employeeId ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Selecciona un empleado</p>
        ) : isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando...</p>
        ) : rows.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Sin registros en el periodo</p>
        ) : (
          <>
            {pendientes > 0 && (
              <p className="text-sm text-amber-500">
                {pendientes === 1
                  ? 'Hay 1 jornada sin salida o pendiente de revisión: no cuenta horas hasta que la corrijas.'
                  : `Hay ${pendientes} jornadas sin salida o pendientes de revisión: no cuentan horas hasta que las corrijas.`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total trabajado</div>
                  <div className="text-2xl font-bold">{formatSeconds(totalWorked)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total pausas</div>
                  <div className="text-2xl font-bold">{formatSeconds(totalBreak)}</div>
                </CardContent>
              </Card>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead>Salida</TableHead>
                  <TableHead>Trabajado</TableHead>
                  <TableHead>Pausas</TableHead>
                  <TableHead>Estado</TableHead>
                  {hasCorrections && <TableHead>Motivo de corrección</TableHead>}
                  <TableHead className="w-[1%]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatSessionDate(r.session_date)}</TableCell>
                    <TableCell>{format(new Date(r.clock_in_at), 'HH:mm')}</TableCell>
                    <TableCell>{r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '—'}</TableCell>
                    <TableCell className="font-mono">{formatSeconds(r.worked_seconds)}</TableCell>
                    <TableCell className="font-mono">{formatSeconds(r.break_seconds)}</TableCell>
                    <TableCell>
                      <SessionStatusBadge session={r} />
                    </TableCell>
                    {hasCorrections && (
                      <TableCell className="text-sm text-muted-foreground">{r.correction_reason ?? ''}</TableCell>
                    )}
                    <TableCell>
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => setEditing(r)}>
                        <Pencil className="w-3.5 h-3.5" />
                        Corregir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        <CorrectSessionDialog session={editing} onClose={() => setEditing(null)} onSubmit={correctSession} />
      </CardContent>
    </Card>
  );
}
