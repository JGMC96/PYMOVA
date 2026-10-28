import { Badge } from '@/components/ui/badge';
import type { MonthlyReportRow } from '@/hooks/useHrReports';
import { sessionStatusLabel } from '@/lib/hrReport';

/** Estado de una jornada en los informes. Las cerradas sin incidencias no llevan etiqueta. */
export function SessionStatusBadge({ session }: { session: MonthlyReportRow }) {
  const label = sessionStatusLabel(session);
  switch (label) {
    case 'Pendiente de revisión':
    case 'Sin salida':
      return <Badge variant="destructive">{label}</Badge>;
    case 'Corregida':
      return <Badge variant="secondary">{label}</Badge>;
    case 'Abierta':
      return <Badge variant="outline">{label}</Badge>;
    default:
      return null;
  }
}
