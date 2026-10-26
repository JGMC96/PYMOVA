import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { SessionCorrection } from '@/hooks/useHrReports';
import type { PendingReviewRow } from '@/hooks/useHrPendingReviews';
import { formatSessionDate } from '@/lib/hrReport';
import { CorrectSessionDialog } from './CorrectSessionDialog';
import { SessionStatusBadge } from './SessionStatusBadge';

interface PendingReviewsCardProps {
  rows: PendingReviewRow[];
  onClose: (sessionId: string, correction: SessionCorrection) => Promise<boolean>;
}

/** Jornadas sin salida o pendientes de revisión del equipo, para cerrarlas con su motivo. */
export function PendingReviewsCard({ rows, onClose }: PendingReviewsCardProps) {
  const [editing, setEditing] = useState<PendingReviewRow | null>(null);

  if (!rows.length) return null;

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base">Jornadas por revisar</CardTitle>
        <p className="text-sm text-muted-foreground">
          Se olvidó fichar la salida y no cuentan horas. Ciérralas con la hora real y el motivo: queda en la auditoría.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empleado</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Entrada</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.employee_name}</TableCell>
                <TableCell>{formatSessionDate(r.session_date)}</TableCell>
                <TableCell>{format(new Date(r.clock_in_at), 'HH:mm')}</TableCell>
                <TableCell>
                  <SessionStatusBadge session={r} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="gap-1 whitespace-nowrap" onClick={() => setEditing(r)}>
                    <Pencil className="w-3.5 h-3.5" />
                    Cerrar jornada
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CorrectSessionDialog session={editing} onClose={() => setEditing(null)} onSubmit={onClose} />
      </CardContent>
    </Card>
  );
}
