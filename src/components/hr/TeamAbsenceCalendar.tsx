import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAbsences } from '@/hooks/useAbsences';
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameDay, startOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const TYPE_COLOR = {
  vacation: 'bg-sky-500/30 text-sky-200',
  sick_leave: 'bg-rose-500/30 text-rose-200',
  personal: 'bg-amber-500/30 text-amber-200',
  other: 'bg-slate-500/30 text-slate-200',
};

export function TeamAbsenceCalendar() {
  const [cursor, setCursor] = useState(new Date());
  const { absences } = useAbsences({ scope: 'team', status: 'approved' });

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const inMonth = (d: Date) => d.getMonth() === cursor.getMonth();

  const absencesForDay = (d: Date) =>
    absences.filter((a) => {
      const s = new Date(a.start_date);
      const e = new Date(a.end_date);
      return d >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
             d <= new Date(e.getFullYear(), e.getMonth(), e.getDate());
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base capitalize">
          {format(cursor, 'MMMM yyyy', { locale: es })}
        </CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>
            Hoy
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground mb-1">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="p-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const items = absencesForDay(d);
            const today = isSameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  'min-h-[80px] p-1.5 rounded-md border border-border/40',
                  inMonth(d) ? 'bg-card' : 'bg-muted/20',
                  today && 'ring-1 ring-primary'
                )}
              >
                <div className={cn('text-xs font-semibold mb-1', !inMonth(d) && 'text-muted-foreground')}>
                  {d.getDate()}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((a) => (
                    <div
                      key={a.id}
                      className={cn('text-[10px] px-1 py-0.5 rounded truncate', TYPE_COLOR[a.absence_type])}
                      title={`${a.employee_name || ''} - ${a.absence_type}`}
                    >
                      {a.employee_name || '—'}
                    </div>
                  ))}
                  {items.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{items.length - 3}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
