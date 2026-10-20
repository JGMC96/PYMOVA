// Gestión de dependientes del TPV (admins) e informe de ventas por vendedor.
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useSellerSession } from '@/contexts/SellerSessionContext';

export interface SellerReportRow {
  employee_id: string | null;
  name: string;
  sales_count: number;
  sales_total: number;
  returns_count: number;
  returns_total: number;
  net_total: number;
}

// RPC nuevas de la 0027: `as never` hasta que se regenere types.ts.
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never);

export function useSellers() {
  const { activeBusinessId, user } = useBusiness();
  const { employees, isLoadingEmployees, refreshEmployees } = useSellerSession();
  const [isSaving, setIsSaving] = useState(false);

  const run = useCallback(
    async (name: string, args: Record<string, unknown>, okMessage: string): Promise<boolean> => {
      if (!activeBusinessId) return false;
      setIsSaving(true);
      const { error } = await rpc(name, { _business_id: activeBusinessId, ...args });
      setIsSaving(false);
      if (error) {
        toast.error(error.message);
        return false;
      }
      toast.success(okMessage);
      await refreshEmployees();
      return true;
    },
    [activeBusinessId, refreshEmployees],
  );

  const createEmployee = (name: string) =>
    run('upsert_pos_employee', { _employee_id: null, _display_name: name, _is_active: true }, 'Dependiente creado');

  const renameEmployee = (id: string, name: string) =>
    run('upsert_pos_employee', { _employee_id: id, _display_name: name, _is_active: null }, 'Nombre guardado');

  const setActive = (id: string, isActive: boolean) =>
    run(
      'upsert_pos_employee',
      { _employee_id: id, _display_name: employees.find((e) => e.id === id)?.name ?? null, _is_active: isActive },
      isActive ? 'Dependiente activado' : 'Dependiente desactivado',
    );

  const setPin = (id: string, pin: string) => run('set_employee_pin', { _employee_id: id, _pin: pin }, 'PIN guardado');

  /** Crea el empleado de RR. HH. de la cuenta actual, para poder ponerle PIN. */
  const ensureMyEmployee = () => run('ensure_hr_employee', {}, 'Ya apareces como vendedor');

  const myEmployee = employees.find((e) => e.user_id && e.user_id === user?.id) ?? null;

  const salesBySeller = useCallback(
    async (from: string, to: string): Promise<SellerReportRow[]> => {
      if (!activeBusinessId) return [];
      const { data, error } = await rpc('get_sales_by_seller', { _business_id: activeBusinessId, _from: from, _to: to });
      if (error) {
        toast.error(error.message);
        return [];
      }
      return ((data ?? []) as SellerReportRow[]).map((r) => ({
        ...r,
        sales_total: Number(r.sales_total),
        returns_total: Number(r.returns_total),
        net_total: Number(r.net_total),
      }));
    },
    [activeBusinessId],
  );

  const reassignSale = useCallback(
    async (saleId: string, employeeId: string | null, reason: string): Promise<boolean> => {
      setIsSaving(true);
      const { error } = await rpc('reassign_sale_seller', { _sale_id: saleId, _employee_id: employeeId, _reason: reason });
      setIsSaving(false);
      if (error) {
        toast.error(error.message);
        return false;
      }
      toast.success('Vendedor cambiado');
      return true;
    },
    [],
  );

  return {
    employees,
    isLoading: isLoadingEmployees,
    isSaving,
    myEmployee,
    createEmployee,
    renameEmployee,
    setActive,
    setPin,
    ensureMyEmployee,
    salesBySeller,
    reassignSale,
    refresh: refreshEmployees,
  };
}
