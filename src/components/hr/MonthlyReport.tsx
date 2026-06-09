import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { useHrEmployees } from '@/hooks/useHrEmployees';
import { useHrReports } from '@/hooks/useHrReports';

const formatSeconds = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

export function MonthlyReport() {
  const { employees } = useHrEmployees();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employeeId, setEmployeeId] = useState<string>('');

  const { rows, isLoading } = useHrReports(employeeId || null, year, month);

  const totalWorked = rows.reduce((sum, r) => sum + r.worked_seconds, 0);
  const totalBreak = rows.reduce((sum, r) => sum + r.break_seconds, 0);

  const exportCsv = () => {
    const header = 'Fecha,Entrada,Salida,Trabajado(h),Pausas(h)\n';
    const lines = rows.map((r) =>
      [
        r.session_date,
        format(new Date(r.clock_in_at), 'HH:mm'),
        r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '',
        (r.worked_seconds / 3600).toFixed(2),
        (r.break_seconds / 3600).toFixed(2),
      ].join(',')
    );
    const csv = header + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_${year}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
                <SelectItem key={m} value={String(m)}>{format(new Date(2000, m - 1, 1), 'MMMM')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.session_date}>
                    <TableCell>{format(new Date(r.session_date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{format(new Date(r.clock_in_at), 'HH:mm')}</TableCell>
                    <TableCell>{r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '—'}</TableCell>
                    <TableCell className="font-mono">{formatSeconds(r.worked_seconds)}</TableCell>
                    <TableCell className="font-mono">{formatSeconds(r.break_seconds)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
