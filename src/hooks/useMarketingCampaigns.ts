// Campañas, fechas clave y objetivos de marketing (fase 1b). Los ve todo el equipo; los crea y
// cambia un administrador (lo comprueba la RLS).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import { upcomingKeyDates } from '@/lib/marketingKeyDates';
import type {
  MarketingCampaign,
  MarketingCampaignKind,
  MarketingGoal,
  MarketingGoalMetric,
} from '@/types/database';

export interface CampaignFormData {
  name: string;
  kind: MarketingCampaignKind;
  starts_on: string;
  ends_on: string;
  color?: string | null;
  goal?: string;
  notes?: string;
}

export interface GoalFormData {
  title: string;
  metric: MarketingGoalMetric;
  target: number;
  current: number;
  starts_on: string;
  ends_on: string;
  campaign_id?: string | null;
  notes?: string;
}

const CAMPAIGN_COLUMNS = 'id, business_id, name, kind, starts_on, ends_on, color, goal, notes, created_at';
const GOAL_COLUMNS = 'id, business_id, title, metric, target, current, starts_on, ends_on, campaign_id, notes, created_at';

// Tablas nuevas de la migración de campañas: `as never` hasta que se regenere types.ts.
const table = (name: 'marketing_campaigns' | 'marketing_goals') =>
  supabase.from(name as never) as unknown as ReturnType<typeof supabase.from>;

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Error inesperado');

export function useMarketingCampaigns() {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();

  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [goals, setGoals] = useState<MarketingGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!activeBusinessId) {
      setCampaigns([]);
      setGoals([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [c, g] = await Promise.all([
      table('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('business_id', activeBusinessId).order('starts_on'),
      table('marketing_goals').select(GOAL_COLUMNS).eq('business_id', activeBusinessId).order('starts_on'),
    ]);
    if (requestId !== requestIdRef.current) return;
    if (c.error) console.error('Error fetching campaigns:', c.error);
    if (g.error) console.error('Error fetching goals:', g.error);
    setCampaigns((c.data ?? []) as unknown as MarketingCampaign[]);
    setGoals(
      ((g.data ?? []) as unknown as MarketingGoal[]).map((r) => ({
        ...r,
        target: Number(r.target),
        current: Number(r.current),
      })),
    );
    setIsLoading(false);
  }, [activeBusinessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Guarda (nueva si no hay id) y avisa. Devuelve si fue bien. */
  const run = useCallback(
    async (action: () => PromiseLike<{ error: unknown }>, ok: string, ko: string) => {
      try {
        const { error } = await action();
        if (error) throw error;
        toast({ title: ok });
        await reload();
        return true;
      } catch (err) {
        console.error(ko, err);
        toast({ title: ko, description: errorText(err), variant: 'destructive' });
        return false;
      }
    },
    [reload, toast],
  );

  const normalizeCampaign = (d: CampaignFormData) => ({
    name: d.name.trim(),
    kind: d.kind,
    starts_on: d.starts_on,
    ends_on: d.ends_on,
    color: d.color || null,
    goal: d.goal?.trim() || null,
    notes: d.notes?.trim() || null,
  });

  const saveCampaign = useCallback(
    (data: CampaignFormData, id?: string) => {
      if (!activeBusinessId) return Promise.resolve(false);
      const row = normalizeCampaign(data);
      return id
        ? run(
            () => table('marketing_campaigns').update(row as never).eq('id', id).eq('business_id', activeBusinessId),
            'Campaña guardada',
            'No se pudo guardar la campaña',
          )
        : run(
            () => table('marketing_campaigns').insert({ ...row, business_id: activeBusinessId } as never),
            row.kind === 'key_date' ? 'Fecha clave añadida' : 'Campaña creada',
            'No se pudo crear la campaña',
          );
    },
    [activeBusinessId, run],
  );

  const deleteCampaign = useCallback(
    (id: string) =>
      run(
        () => table('marketing_campaigns').delete().eq('id', id).eq('business_id', activeBusinessId ?? ''),
        'Campaña eliminada',
        'No se pudo eliminar la campaña',
      ),
    [activeBusinessId, run],
  );

  /** Carga las fechas clave de los próximos 12 meses que aún no estén. Devuelve cuántas añadió. */
  const addKeyDates = useCallback(async (): Promise<number> => {
    if (!activeBusinessId) return 0;
    const existing = new Set(
      campaigns.filter((c) => c.kind === 'key_date').map((c) => `${c.name.toLowerCase()}|${c.starts_on}`),
    );
    const missing = upcomingKeyDates(new Date()).filter(
      (k) => !existing.has(`${k.name.toLowerCase()}|${k.starts_on}`),
    );
    if (missing.length === 0) {
      toast({ title: 'Las fechas clave ya están en el calendario' });
      return 0;
    }
    const ok = await run(
      () =>
        table('marketing_campaigns').insert(
          missing.map((k) => ({ ...k, kind: 'key_date', business_id: activeBusinessId })) as never,
        ),
      `${missing.length} fechas clave añadidas`,
      'No se pudieron añadir las fechas clave',
    );
    return ok ? missing.length : 0;
  }, [activeBusinessId, campaigns, run, toast]);

  const normalizeGoal = (d: GoalFormData) => ({
    title: d.title.trim(),
    metric: d.metric,
    target: d.target,
    current: d.current,
    starts_on: d.starts_on,
    ends_on: d.ends_on,
    campaign_id: d.campaign_id || null,
    notes: d.notes?.trim() || null,
  });

  const saveGoal = useCallback(
    (data: GoalFormData, id?: string) => {
      if (!activeBusinessId) return Promise.resolve(false);
      const row = normalizeGoal(data);
      return id
        ? run(
            () => table('marketing_goals').update(row as never).eq('id', id).eq('business_id', activeBusinessId),
            'Objetivo guardado',
            'No se pudo guardar el objetivo',
          )
        : run(
            () => table('marketing_goals').insert({ ...row, business_id: activeBusinessId } as never),
            'Objetivo creado',
            'No se pudo crear el objetivo',
          );
    },
    [activeBusinessId, run],
  );

  const deleteGoal = useCallback(
    (id: string) =>
      run(
        () => table('marketing_goals').delete().eq('id', id).eq('business_id', activeBusinessId ?? ''),
        'Objetivo eliminado',
        'No se pudo eliminar el objetivo',
      ),
    [activeBusinessId, run],
  );

  return {
    campaigns,
    goals,
    isLoading,
    reload,
    saveCampaign,
    deleteCampaign,
    addKeyDates,
    saveGoal,
    deleteGoal,
  };
}
