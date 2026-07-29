import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

export interface IntegrationInterest {
  id: string;
  integration_key: string;
  requested_by: string | null;
  created_at: string;
}

export function useIntegrationInterests() {
  const { activeBusinessId, user } = useBusiness();
  const [interests, setInterests] = useState<IntegrationInterest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchInterests = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!activeBusinessId) {
      setInterests([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from('integration_interests')
      .select('id, integration_key, requested_by, created_at')
      .eq('business_id', activeBusinessId)
      .order('created_at', { ascending: true });

    if (requestId !== requestIdRef.current) return;

    if (error) {
      console.error('Error fetching integration interests:', error);
    } else {
      setInterests(data || []);
    }
    setIsLoading(false);
  }, [activeBusinessId]);

  useEffect(() => {
    fetchInterests();
  }, [fetchInterests]);

  const toggleInterest = useCallback(
    async (integrationKey: string, integrationName: string) => {
      if (!activeBusinessId || !user) {
        toast.error('No hay negocio activo');
        return;
      }

      const existing = interests.find((i) => i.integration_key === integrationKey);
      setSavingKey(integrationKey);

      try {
        if (existing) {
          const { error } = await supabase
            .from('integration_interests')
            .delete()
            .eq('id', existing.id);
          if (error) throw error;
          setInterests((prev) => prev.filter((i) => i.id !== existing.id));
          toast.success(`Interés retirado de ${integrationName}`);
        } else {
          const { data, error } = await supabase
            .from('integration_interests')
            .insert({
              business_id: activeBusinessId,
              integration_key: integrationKey,
              requested_by: user.id,
            })
            .select('id, integration_key, requested_by, created_at')
            .single();
          if (error) throw error;
          setInterests((prev) => [...prev, data]);
          toast.success(`Interés registrado en ${integrationName}`, {
            description: 'Te avisaremos en cuanto esta integración esté disponible.',
          });
        }
      } catch (err) {
        console.error('Error saving integration interest:', err);
        toast.error('No se pudo guardar tu interés', {
          description: err instanceof Error ? err.message : 'Inténtalo de nuevo.',
        });
      } finally {
        setSavingKey(null);
      }
    },
    [activeBusinessId, user, interests]
  );

  return { interests, isLoading, savingKey, toggleInterest, refresh: fetchInterests };
}
