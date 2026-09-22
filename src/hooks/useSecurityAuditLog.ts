import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export interface SecurityAuditEntry {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
}

const PAGE_SIZE = 50;

export function useSecurityAuditLog() {
  const { activeBusinessId } = useBusiness();
  const [entries, setEntries] = useState<SecurityAuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      if (!activeBusinessId) {
        setEntries([]);
        setIsLoading(false);
        return;
      }

      const requestId = ++requestIdRef.current;
      setIsLoading(true);

      const { data, error } = await supabase.rpc('get_security_audit_log', {
        _business_id: activeBusinessId,
        _limit: PAGE_SIZE,
        _offset: offset,
      });

      if (requestId !== requestIdRef.current) return;

      if (error) {
        console.error('get_security_audit_log failed:', error);
        setEntries((prev) => (offset === 0 ? [] : prev));
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as SecurityAuditEntry[];
      setEntries((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setIsLoading(false);
    },
    [activeBusinessId],
  );

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(entries.length);
  }, [fetchPage, entries.length]);

  return {
    entries,
    isLoading,
    hasMore,
    loadMore,
    refetch: () => fetchPage(0),
  };
}
