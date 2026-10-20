import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';

export type ActivityEventType = 'payment' | 'invoice' | 'client';

export interface ActivityEvent {
  event_type: ActivityEventType;
  event_id: string;
  title: string;
  description: string;
  amount: number | null;
  created_at: string;
}

interface UseRecentActivityReturn {
  activities: ActivityEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Format a date string to a relative time string in Spanish
 */
export function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Ahora';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  
  return new Intl.DateTimeFormat('es-ES', { 
    day: 'numeric', 
    month: 'short' 
  }).format(past);
}

/**
 * Hook to fetch recent activity (payments, invoices, clients) for the active business
 */
export function useRecentActivity(limit: number = 10): UseRecentActivityReturn {
  const { activeBusinessId } = useBusiness();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Race condition protection
  const requestIdRef = useRef(0);

  const fetchActivity = useCallback(async () => {
    if (!activeBusinessId) {
      setActivities([]);
      setIsLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_recent_activity', {
        _business_id: activeBusinessId,
        _limit: limit
      });

      // Ignore stale responses
      if (currentRequestId !== requestIdRef.current) return;

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      // Normalize amount from Postgres numeric (string) to JavaScript number
      const rows = (data as any[] | null) ?? [];
      const normalized: ActivityEvent[] = rows.map((r) => ({
        event_type: r.event_type as ActivityEventType,
        event_id: r.event_id,
        title: r.title,
        description: r.description,
        amount: r.amount === null ? null : Number(r.amount),
        created_at: r.created_at,
      }));

      setActivities(normalized);
    } catch (err) {
      // Ignore stale errors
      if (currentRequestId !== requestIdRef.current) return;
      
      console.error('Error fetching recent activity:', err);
      setError(err instanceof Error ? err : new Error('Error desconocido'));
      setActivities([]);
    } finally {
      // Only update loading state for current request
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeBusinessId, limit]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return {
    activities,
    isLoading,
    error,
    refetch: fetchActivity
  };
}
