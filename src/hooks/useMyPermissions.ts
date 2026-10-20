// Permisos de la cuenta con la sesión abierta (0031): cambiar productos y precios, ver
// costes y ajustar stock. Los comprueba también el servidor; aquí solo se usan para
// mostrar u ocultar acciones.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export interface MyPermissions {
  canEditCatalog: boolean;
  canSeeCosts: boolean;
  canAdjustStock: boolean;
  isLoading: boolean;
}

const NONE = { canEditCatalog: false, canSeeCosts: false, canAdjustStock: false };

export function useMyPermissions(): MyPermissions {
  const { activeBusinessId } = useBusiness();
  const [perms, setPerms] = useState(NONE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessId) {
      setPerms(NONE);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // RPC nueva de la 0031: `as never` hasta que se regenere types.ts.
    void supabase
      .rpc('get_my_permissions' as never, { _business_id: activeBusinessId } as never)
      .then(({ data, error }) => {
        if (cancelled) return;
        const rows = (data ?? null) as unknown;
        const row = (Array.isArray(rows) ? rows[0] : rows) as
          | { can_edit_catalog: boolean; can_see_costs: boolean; can_adjust_stock: boolean }
          | null;
        if (error || !row) {
          if (error) console.error('get_my_permissions', error);
          setPerms(NONE);
        } else {
          setPerms({
            canEditCatalog: !!row.can_edit_catalog,
            canSeeCosts: !!row.can_see_costs,
            canAdjustStock: !!row.can_adjust_stock,
          });
        }
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId]);

  return { ...perms, isLoading };
}
