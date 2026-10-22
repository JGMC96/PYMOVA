// Lista de clientas paginada con sus números (list_clients_with_stats, 0044). La lista de
// antes se cortaba en 1.000 filas.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export type ClientSort = 'name' | 'spent' | 'last_purchase' | 'purchases';

export interface ClientWithStats {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  purchases: number;
  spent: number;
  last_purchase_at: string | null;
}

export const CLIENT_PAGE_SIZE = 50;

export function useClientList() {
  const { activeBusinessId } = useBusiness();
  const [clients, setClients] = useState<ClientWithStats[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<ClientSort>('name');
  const [page, setPage] = useState(0);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (!activeBusinessId) {
      setClients([]);
      setTotal(0);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // RPC de la 0044: `as never` hasta que se regenere types.ts.
    const { data, error: rpcError } = await supabase.rpc('list_clients_with_stats' as never, {
      _business_id: activeBusinessId,
      _search: searchTerm.trim() || null,
      _include_inactive: showInactive,
      _sort: sort,
      _limit: CLIENT_PAGE_SIZE,
      _offset: page * CLIENT_PAGE_SIZE,
    } as never);
    if (id !== requestId.current) return;
    if (rpcError) {
      console.error('list_clients_with_stats', rpcError);
      setError(rpcError.message);
      setClients([]);
      setTotal(0);
    } else {
      const rows = (data ?? []) as unknown as (ClientWithStats & { total_count: number | string })[];
      setError(null);
      setClients(rows.map(({ total_count: _t, ...r }) => ({ ...r, purchases: Number(r.purchases), spent: Number(r.spent) })));
      setTotal(rows.length ? Number(rows[0].total_count) : 0);
    }
    setIsLoading(false);
  }, [activeBusinessId, searchTerm, showInactive, sort, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Al cambiar búsqueda, filtro u orden se vuelve a la primera página.
  const changeSearch = useCallback((term: string) => {
    setSearchTerm(term);
    setPage(0);
  }, []);
  const changeShowInactive = useCallback((v: boolean) => {
    setShowInactive(v);
    setPage(0);
  }, []);
  const changeSort = useCallback((v: ClientSort) => {
    setSort(v);
    setPage(0);
  }, []);

  return {
    clients,
    total,
    isLoading,
    error,
    searchTerm,
    setSearchTerm: changeSearch,
    showInactive,
    setShowInactive: changeShowInactive,
    sort,
    setSort: changeSort,
    page,
    setPage,
    pageCount: Math.max(1, Math.ceil(total / CLIENT_PAGE_SIZE)),
    refresh,
  };
}
