import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { useHrReports } from '@/hooks/useHrReports';
import {
  buildMonthlyCsv,
  downloadCsv,
  formatSeconds,
  formatSessionDate,
  monthName,
  monthlyTotals,
  reportYears,
} from '@/lib/hrReport';
import { SessionStatusBadge } from './SessionStatusBadge';

/**
 * Registro de jornada del propio trabajador (art. 34.9 ET): sus sesiones del mes,
 * con las correcciones y su motivo, y descarga en CSV. Solo lectura.
 */
export function MyTimeRecord({ employeeId }: { employeeId: string | null }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { rows, isLoading } = useHrReports(employeeId, year, month);
  const totals = monthlyTotals(rows);
  const hasCorrections = rows.some((r) => r.correction_reason);

  const exportCsv = () => {
    downloadCsv(buildMonthlyCsv(rows), `registro_jornada_${year}_${String(month).padStart(2, '0')}.csv`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mi registro de jornada</CardTitle>
        <p className="text-sm text-muted-foreground">
          Tus entradas, salidas y pausas de cada mes. Se conservan durante 4 años.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]" aria-label="Mes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)} className="capitalize">{monthName(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]" aria-label="Año">
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
            Descargar CSV
          </Button>
        </div>

        {!employeeId ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Aún no tienes fichajes</p>
        ) : isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando...</p>
        ) : rows.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Sin registros en el periodo</p>
        ) : (
          <>
            {totals.pending > 0 && (
              <p className="text-sm text-amber-500">
                {totals.pending === 1
                  ? 'Tienes 1 jornada sin salida o pendiente de revisión: no cuenta horas. Avisa a un responsable para que la corrija.'
                  : `Tienes ${totals.pending} jornadas sin salida o pendientes de revisión: no cuentan horas. Avisa a un responsable para que las corrija.`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total trabajado</div>
                  <div className="text-2xl font-bold">{formatSeconds(totals.worked)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total pausas</div>
                  <div className="text-2xl font-bold">{formatSeconds(totals.breaks)}</div>
                </CardContent>
              </Card>
            </div>
            <div className="overflow-x-auto">
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
