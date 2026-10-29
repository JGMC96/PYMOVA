// Tareas de marketing (0058). Las ve todo el equipo; las crea y reparte un administrador, y las
// marca como hechas la persona responsable o un administrador (set_marketing_task_done).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type { MarketingTask } from '@/types/database';

export interface TaskFormData {
  title: string;
  notes?: string;
  assignee_id?: string | null;
  due_on?: string | null;
  campaign_id?: string | null;
  post_id?: string | null;
}

const TASK_COLUMNS =
  'id, business_id, title, notes, assignee_id, due_on, done_at, done_by, campaign_id, post_id, created_by, created_at';

// Tabla y función nuevas de la 0058: `as never` hasta que se regenere types.ts.
const table = () => supabase.from('marketing_tasks' as never) as unknown as ReturnType<typeof supabase.from>;
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ error: { message: string } | null }>;

const errorText = (err: unknown) =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Error inesperado';

export function useMarketingTasks() {
  const { activeBusinessId } = useBusiness();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!activeBusinessId) {
      setTasks([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await table()
      .select(TASK_COLUMNS)
      .eq('business_id', activeBusinessId)
      .order('due_on', { ascending: true, nullsFirst: false })
      .order('created_at');
    if (requestId !== requestIdRef.current) return;
    if (error) console.error('Error fetching marketing tasks:', error);
    setTasks((data ?? []) as unknown as MarketingTask[]);
    setIsLoading(false);
  }, [activeBusinessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => PromiseLike<{ error: unknown }>, ok: string | null, ko: string) => {
      try {
        const { error } = await action();
        if (error) throw error;
        if (ok) toast({ title: ok });
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

  const normalize = (d: TaskFormData) => ({
    title: d.title.trim(),
    notes: d.notes?.trim() || null,
    assignee_id: d.assignee_id || null,
    due_on: d.due_on || null,
    campaign_id: d.campaign_id || null,
    post_id: d.post_id || null,
  });

  const saveTask = useCallback(
    (data: TaskFormData, id?: string) => {
      if (!activeBusinessId) return Promise.resolve(false);
      const row = normalize(data);
      return id
        ? run(
            () => table().update(row as never).eq('id', id).eq('business_id', activeBusinessId),
            'Tarea guardada',
            'No se pudo guardar la tarea',
          )
        : run(
            () => table().insert({ ...row, business_id: activeBusinessId } as never),
            'Tarea creada',
            'No se pudo crear la tarea',
          );
    },
    [activeBusinessId, run],
  );

  const deleteTask = useCallback(
    (id: string) =>
      run(
        () => table().delete().eq('id', id).eq('business_id', activeBusinessId ?? ''),
        'Tarea eliminada',
        'No se pudo eliminar la tarea',
      ),
    [activeBusinessId, run],
  );

  const setDone = useCallback(
    (id: string, done: boolean) =>
      run(
        () => rpc('set_marketing_task_done', { _task_id: id, _done: done }),
        null,
        'No se pudo marcar la tarea',
      ),
    [run],
  );

  return { tasks, isLoading, reload, saveTask, deleteTask, setDone };
}
