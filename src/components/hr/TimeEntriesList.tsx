import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { MapPin } from 'lucide-react';
import type { HrTimeEntry, TimeEntryType } from '@/types/database';

const LABEL: Record<TimeEntryType, string> = {
  clock_in: 'Entrada',
  break_start: 'Inicio pausa',
  break_end: 'Fin pausa',
  clock_out: 'Salida',
};

export function TimeEntriesList({ entries }: { entries: HrTimeEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fichajes de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay fichajes registrados hoy
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hora</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ubicación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{format(new Date(e.occurred_at), 'HH:mm:ss')}</TableCell>
                  <TableCell>{LABEL[e.entry_type]}</TableCell>
                  <TableCell>
                    {e.latitude && e.longitude ? (
                      <a
                        href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                      >
                        <MapPin className="w-3 h-3" />
                        Ver
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
