import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useHrEmployees } from '@/hooks/useHrEmployees';

interface Row {
  employee_id: string;
  employee_name: string;
  total_hours: number;
  by_type: Record<string, number>;
  count: number;
}

const TYPE_LABELS: Record<string, string> = {
  late_arrival: 'Llegadas tarde',
  early_departure: 'Salidas anticipadas',
  personal_errand: 'Asuntos personales',
  other: 'Otros',
};

export function MonthlyPermissionsSummary() {
  const { activeBusinessId } = useBusiness();
  const { employees } = useHrEmployees();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!activeBusinessId) return;
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0);
    const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    setIsLoading(true);
    (supabase
      .from('hr_permissions' as any)
      .select('employee_id, permission_type, hours_count')
      .eq('business_id', activeBusinessId)
      .eq('status', 'approved')
      .gte('permission_date', start)
      .lte('permission_date', end) as any)
      .then(({ data, error }: any) => {
        if (!error) setData(data || []);
        setIsLoading(false);
      });
  }, [activeBusinessId, year, month]);

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    const empName = new Map(employees.map((e) => [e.id, e.full_name || e.user_id.slice(0, 8)]));
    for (const r of data) {
      const id = r.employee_id;
      const cur = map.get(id) || { employee_id: id, employee_name: empName.get(id) || id.slice(0, 8), total_hours: 0, by_type: {}, count: 0 };
      cur.total_hours += Number(r.hours_count) || 0;
      cur.by_type[r.permission_type] = (cur.by_type[r.permission_type] || 0) + (Number(r.hours_count) || 0);
      cur.count += 1;
      map.set(id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total_hours - a.total_hours);
  }, [data, employees]);

  const grandTotal = rows.reduce((s, r) => s + r.total_hours, 0);

  const exportCsv = () => {
    const header = 'Empleado,Solicitudes,Llegadas tarde (h),Salidas anticipadas (h),Asuntos personales (h),Otros (h),Total (h)\n';
    const lines = rows.map((r) =>
      [
        `"${r.employee_name}"`,
        r.count,
        (r.by_type.late_arrival || 0).toFixed(2),
        (r.by_type.early_departure || 0).toFixed(2),
        (r.by_type.personal_errand || 0).toFixed(2),
        (r.by_type.other || 0).toFixed(2),
        r.total_hours.toFixed(2),
      ].join(',')
    );
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `permisos_${year}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumen mensual de permisos aprobados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>{format(new Date(2000, m - 1, 1), 'MMMM')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length} className="gap-2 ml-auto">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Cargando...</p>
        ) : rows.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Sin permisos aprobados en el periodo</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total horas</div>
                  <div className="text-2xl font-bold">{grandTotal.toFixed(2)}h</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Empleados</div>
                  <div className="text-2xl font-bold">{rows.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Solicitudes</div>
                  <div className="text-2xl font-bold">{rows.reduce((s, r) => s + r.count, 0)}</div>
                </CardContent>
              </Card>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead className="text-right">Solicitudes</TableHead>
                  <TableHead className="text-right">Llegadas tarde</TableHead>
                  <TableHead className="text-right">Salidas antic.</TableHead>
                  <TableHead className="text-right">Asuntos pers.</TableHead>
                  <TableHead className="text-right">Otros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employee_id}>
                    <TableCell className="font-medium">{r.employee_name}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right font-mono">{(r.by_type.late_arrival || 0).toFixed(2)}h</TableCell>
                    <TableCell className="text-right font-mono">{(r.by_type.early_departure || 0).toFixed(2)}h</TableCell>
                    <TableCell className="text-right font-mono">{(r.by_type.personal_errand || 0).toFixed(2)}h</TableCell>
                    <TableCell className="text-right font-mono">{(r.by_type.other || 0).toFixed(2)}h</TableCell>
                    <TableCell className="text-right font-mono font-bold">{r.total_hours.toFixed(2)}h</TableCell>
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
