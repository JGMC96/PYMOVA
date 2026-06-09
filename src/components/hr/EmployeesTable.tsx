import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Edit2, UserPlus } from 'lucide-react';
import { useHrEmployees, type EmployeeWithProfile } from '@/hooks/useHrEmployees';
import { format } from 'date-fns';

export function EmployeesTable() {
  const { employees, isLoading, updateEmployee, enrollAllMembers } = useHrEmployees();
  const [editing, setEditing] = useState<EmployeeWithProfile | null>(null);
  const [form, setForm] = useState({ hire_date: '', weekly_hours: 40, annual_vacation_days: 22, is_active: true });

  const openEdit = (e: EmployeeWithProfile) => {
    setEditing(e);
    setForm({
      hire_date: e.hire_date || '',
      weekly_hours: e.weekly_hours,
      annual_vacation_days: e.annual_vacation_days,
      is_active: e.is_active,
    });
  };

  const save = async () => {
    if (!editing) return;
    const ok = await updateEmployee(editing.id, {
      hire_date: form.hire_date || null,
      weekly_hours: form.weekly_hours,
      annual_vacation_days: form.annual_vacation_days,
      is_active: form.is_active,
    });
    if (ok) setEditing(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Empleados</CardTitle>
        <Button size="sm" variant="outline" onClick={enrollAllMembers} className="gap-2">
          <UserPlus className="w-4 h-4" />
          Sincronizar miembros
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Cargando...</p>
        ) : employees.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay empleados registrados. Usa "Sincronizar miembros" para crear sus perfiles.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead>H/semana</TableHead>
                <TableHead>Vacaciones</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.full_name || '—'}</TableCell>
                  <TableCell>{e.hire_date ? format(new Date(e.hire_date), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell>{e.weekly_hours}</TableCell>
                  <TableCell>{e.annual_vacation_days}</TableCell>
                  <TableCell>{e.is_active ? 'Sí' : 'No'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar empleado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Fecha de alta</Label>
              <Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Horas semanales</Label>
              <Input
                type="number"
                step="0.5"
                value={form.weekly_hours}
                onChange={(e) => setForm({ ...form, weekly_hours: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Días de vacaciones anuales</Label>
              <Input
                type="number"
                value={form.annual_vacation_days}
                onChange={(e) => setForm({ ...form, annual_vacation_days: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label>Activo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
