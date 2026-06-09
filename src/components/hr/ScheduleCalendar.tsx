import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useSchedules } from '@/hooks/useSchedules';
import { useHrEmployees } from '@/hooks/useHrEmployees';

export function ScheduleCalendar() {
  const [cursor, setCursor] = useState(new Date());
  const { schedules, createSchedule, deleteSchedule } = useSchedules(cursor);
  const { employees } = useHrEmployees();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', shift_date: '', start_time: '09:00', end_time: '17:00', notes: '' });

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const empMap = new Map(employees.map((e) => [e.id, e.full_name || '—']));
  const inMonth = (d: Date) => d.getMonth() === cursor.getMonth();

  const openFor = (d: Date) => {
    setForm({ employee_id: employees[0]?.id || '', shift_date: format(d, 'yyyy-MM-dd'), start_time: '09:00', end_time: '17:00', notes: '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.employee_id || !form.shift_date) return;
    const ok = await createSchedule(form.employee_id, form.shift_date, form.start_time, form.end_time, form.notes);
    if (ok) setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base capitalize">
          Turnos · {format(cursor, 'MMMM yyyy', { locale: es })}
        </CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>Hoy</Button>
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
            const items = schedules.filter((s) => isSameDay(new Date(s.shift_date), d));
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  'min-h-[90px] p-1.5 rounded-md border border-border/40 relative group',
                  inMonth(d) ? 'bg-card' : 'bg-muted/20'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('text-xs font-semibold', !inMonth(d) && 'text-muted-foreground')}>
                    {d.getDate()}
                  </span>
                  <button
                    onClick={() => openFor(d)}
                    className="opacity-0 group-hover:opacity-100 text-primary"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {items.map((s) => (
                    <div key={s.id} className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary flex items-center justify-between gap-1">
                      <span className="truncate">{empMap.get(s.employee_id)} · {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span>
                      <button onClick={() => deleteSchedule(s.id)}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Empleado</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name || e.user_id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input type="date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Inicio</Label>
                <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Fin</Label>
                <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
