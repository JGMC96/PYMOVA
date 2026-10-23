// Informe mensual de jornada: formato de horas, estado de cada sesión y CSV.
// Lo usan el informe de administradores y «Mi registro» del propio trabajador,
// para que los dos muestren y exporten exactamente lo mismo.
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { MonthlyReportRow } from '@/hooks/useHrReports';
import { csvRow } from '@/lib/csv';

export function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** session_date llega como AAAA-MM-DD; se lee como texto para que la zona horaria no cambie el día. */
export function formatSessionDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function sessionStatusLabel(r: MonthlyReportRow): string {
  return r.needs_review ? 'Pendiente de revisión' : r.correction_reason ? 'Corregida' : r.status === 'open' ? 'Abierta' : 'Cerrada';
}

export function monthlyTotals(rows: MonthlyReportRow[]): { worked: number; breaks: number; pending: number } {
  return rows.reduce(
    (t, r) => ({
      worked: t.worked + r.worked_seconds,
      breaks: t.breaks + r.break_seconds,
      pending: t.pending + (r.needs_review ? 1 : 0),
    }),
    { worked: 0, breaks: 0, pending: 0 },
  );
}

/** CSV del mes. Entrada y salida van en la hora local del navegador, como en la pantalla. */
export function buildMonthlyCsv(rows: MonthlyReportRow[]): string {
  const header = csvRow(['Fecha', 'Entrada', 'Salida', 'Trabajado(h)', 'Pausas(h)', 'Estado', 'Motivo de corrección']);
  const lines = rows.map((r) =>
    csvRow([
      r.session_date,
      format(new Date(r.clock_in_at), 'HH:mm'),
      r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '',
      (r.worked_seconds / 3600).toFixed(2),
      (r.break_seconds / 3600).toFixed(2),
      sessionStatusLabel(r),
      r.correction_reason ?? '',
    ]),
  );
  return [header, ...lines].join('\n');
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Nombre del mes (1-12) en español. */
export function monthName(month: number): string {
  return format(new Date(2000, month - 1, 1), 'MMMM', { locale: es });
}

/** Años que se pueden consultar: los 4 que hay que conservar el registro y el actual. */
export function reportYears(currentYear: number): number[] {
  return Array.from({ length: 5 }, (_, i) => currentYear - i);
}
