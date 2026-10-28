import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { canToggleTask, sortTasks, taskState, type TaskState } from '@/lib/marketingPlan';
import type { MarketingCampaign, MarketingTask } from '@/types/database';
import type { TeamMember } from '@/hooks/useMarketingPosts';

interface MarketingTasksProps {
  tasks: MarketingTask[];
  teamMembers: TeamMember[];
  campaigns: MarketingCampaign[];
  currentUserId: string | null;
  isAdmin: boolean;
  onNew: () => void;
  onSelect: (t: MarketingTask) => void;
  onToggle: (id: string, done: boolean) => Promise<boolean>;
}

const STATE_LABEL: Partial<Record<TaskState, string>> = { overdue: 'Vencida', today: 'Hoy' };

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

export function MarketingTasks({
  tasks,
  teamMembers,
  campaigns,
  currentUserId,
  isAdmin,
  onNew,
  onSelect,
  onToggle,
}: MarketingTasksProps) {
  // El personal empieza viendo lo suyo; un administrador, todo.
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayKey();

  const name = (id: string | null) =>
    id ? teamMembers.find((m) => m.user_id === id)?.full_name || 'Sin nombre' : 'Sin asignar';
  const campaignName = (id: string | null) => (id ? campaigns.find((c) => c.id === id)?.name : undefined);

  const visible = useMemo(
    () =>
      sortTasks(
        tasks.filter((t) => (scope === 'all' || t.assignee_id === currentUserId) && (showDone || !t.done_at)),
        today,
      ),
    [tasks, scope, currentUserId, showDone, today],
  );

  const toggle = async (t: MarketingTask) => {
    setBusy(t.id);
    try {
      await onToggle(t.id, !t.done_at);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={scope}
          onValueChange={(v) => v && setScope(v as 'mine' | 'all')}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="mine">Mis tareas</ToggleGroupItem>
          <ToggleGroupItem value="all">Todas</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="ver-hechas" checked={showDone} onCheckedChange={setShowDone} />
            <Label htmlFor="ver-hechas" className="text-sm font-normal">
              Ver hechas
            </Label>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={onNew}>
              <Plus className="mr-1 h-4 w-4" /> Nueva tarea
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {scope === 'mine' ? 'No tienes tareas pendientes.' : 'No hay tareas pendientes.'}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {visible.map((t) => {
            const state = taskState(t, today);
            const canToggle = canToggleTask(t, currentUserId, isAdmin);
            const campaign = campaignName(t.campaign_id);
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <Checkbox
                  checked={!!t.done_at}
                  disabled={!canToggle || busy === t.id}
                  onCheckedChange={() => toggle(t)}
                  aria-label={t.done_at ? `Desmarcar «${t.title}»` : `Marcar «${t.title}» como hecha`}
                />
                <button type="button" onClick={() => onSelect(t)} className="flex-1 min-w-0 text-left">
                  <span className={cn('block font-medium truncate', t.done_at && 'line-through text-muted-foreground')}>
                    {t.title}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {name(t.assignee_id)}
                    {campaign && ` · ${campaign}`}
                  </span>
                </button>
                {t.due_on && (
                  <span
                    className={cn(
                      'whitespace-nowrap text-xs',
                      state === 'overdue' && 'font-medium text-destructive',
                      state === 'today' && 'font-medium text-primary',
                      (state === 'pending' || state === 'done') && 'text-muted-foreground',
                    )}
                  >
                    {STATE_LABEL[state] ? `${STATE_LABEL[state]} · ` : ''}
                    {format(parseISO(t.due_on), 'd MMM', { locale: es })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
