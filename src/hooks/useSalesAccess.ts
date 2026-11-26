// Permiso «Ver ventas» (0064). Lo comprueba el servidor; aquí solo se usa para mostrar u
// ocultar el apartado y para que el propietario lo conceda.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

/** ¿Puede esta cuenta ver las ventas del negocio activo? El propietario, siempre. */
export function useCanSeeSales() {
  const { activeBusinessId, user, userRole } = useBusiness();
  const isOwner = userRole === 'owner';
  const query = useQuery({
    queryKey: ['can-see-sales', user?.id, activeBusinessId],
    enabled: !!activeBusinessId && !!user && !isOwner,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_see_sales' as never, { _business_id: activeBusinessId } as never);
      if (error) throw new Error(error.message);
      return (data as unknown) === true;
    },
  });
  return {
    canSeeSales: isOwner || query.data === true,
    isLoading: !activeBusinessId || (!isOwner && query.isLoading),
  };
}

/** Para el propietario: qué personas tienen «Ver ventas» y cómo cambiarlo. */
export function useSalesAccess(enabled: boolean) {
  const { activeBusinessId, user } = useBusiness();
  const queryClient = useQueryClient();
  const queryKey = ['sales-access', user?.id, activeBusinessId];

  const query = useQuery({
    queryKey,
    enabled: enabled && !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sales_access' as never, { _business_id: activeBusinessId } as never);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as Array<{ employee_id: string }>).map((r) => r.employee_id);
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ employeeId, allowed }: { employeeId: string; allowed: boolean }) => {
      const { error } = await supabase.rpc('set_sales_access' as never, {
        _business_id: activeBusinessId,
        _employee_id: employeeId,
        _allowed: allowed,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => toast.success('«Ver ventas» guardado'),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    /** Personas con el permiso; undefined mientras carga o si no se ha podido leer. */
    allowed: query.data,
    isSaving: mutation.isPending,
    setAccess: (employeeId: string, allowed: boolean) => mutation.mutateAsync({ employeeId, allowed }),
  };
}
