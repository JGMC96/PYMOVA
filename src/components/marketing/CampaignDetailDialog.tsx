import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ListChecks, Megaphone, Pencil, Plus, Target } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useMoney } from '@/hooks/useMoney';
import {
  campaignColor,
  campaignTiming,
  canToggleTask,
  formatGoalValue,
  goalProgress,
  sortTasks,
  taskState,
  type CampaignTiming,
} from '@/lib/marketingPlan';
import { StatusBadge } from './PostBadge';
import type { MarketingCampaign, MarketingGoal, MarketingPost, MarketingTask } from '@/types/database';
import type { TeamMember } from '@/hooks/useMarketingPosts';

interface CampaignDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: MarketingCampaign | null;
  posts: MarketingPost[];
  tasks: MarketingTask[];
  goals: MarketingGoal[];
  teamMembers: TeamMember[];
  currentUserId: string | null;
  isAdmin: boolean;
  onEdit: () => void;
  onSelectPost: (p: MarketingPost) => void;
  onSelectTask: (t: MarketingTask) => void;
  onSelectGoal: (g: MarketingGoal) => void;
  onNewTask: () => void;
  onNewGoal: () => void;
  onToggleTask: (id: string, done: boolean) => Promise<boolean>;
  /** Crea las tareas típicas de Black Friday que la campaña aún no tiene; devuelve cuántas. */
  onAddTemplateTasks: () => Promise<number>;
}

const TIMING_LABEL: Record<CampaignTiming, string> = {
  current: 'En curso',
  upcoming: 'Próxima',
  past: 'Terminada',
};

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

function dateRange(starts_on: string, ends_on: string) {
  const a = parseISO(starts_on);
  if (starts_on === ends_on) return format(a, "EEEE d 'de' MMMM yyyy", { locale: es });
  return `${format(a, "d 'de' MMMM", { locale: es })} – ${format(parseISO(ends_on), "d 'de' MMMM yyyy", { locale: es })}`;
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon} {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{children}</p>
);

/** Ficha de campaña: el brief y todo lo que cuelga de ella, junto. */
export function CampaignDetailDialog({
  open,
  onOpenChange,
  campaign,
  posts,
  tasks,
  goals,
  teamMembers,
  currentUserId,
  isAdmin,
  onEdit,
  onSelectPost,
  onSelectTask,
  onSelectGoal,
  onNewTask,
  onNewGoal,
  onToggleTask,
  onAddTemplateTasks,
}: CampaignDetailDialogProps) {
  const { currency } = useMoney();
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const today = todayKey();
  const id = campaign?.id;

  const campaignPosts = useMemo(
    () =>
      posts
        .filter((p) => p.campaign_id === id)
        .sort((a, b) => (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999')),
    [posts, id],
  );
  const campaignTasks = useMemo(() => sortTasks(tasks.filter((t) => t.campaign_id === id), today), [tasks, id, today]);
  const campaignGoals = useMemo(() => goals.filter((g) => g.campaign_id === id), [goals, id]);

  if (!campaign) return null;

  const timing = campaignTiming(campaign, today);
  const doneCount = campaignTasks.filter((t) => t.done_at).length;
  const name = (uid: string | null) =>
    uid ? teamMembers.find((m) => m.user_id === uid)?.full_name || 'Sin nombre' : 'Sin asignar';

  const toggle = async (t: MarketingTask) => {
    setBusyTask(t.id);
    try {
      await onToggleTask(t.id, !t.done_at);
    } finally {
      setBusyTask(null);
    }
  };

  const addTemplate = async () => {
    setAddingTemplate(true);
    try {
      await onAddTemplateTasks();
    } finally {
      setAddingTemplate(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span
              className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: campaignColor(campaign) }}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="leading-tight">{campaign.name}</DialogTitle>
              <DialogDescription>
                {dateRange(campaign.starts_on, campaign.ends_on)}
                {campaign.kind === 'key_date' ? ' · Fecha clave' : ''}
              </DialogDescription>
            </div>
            <span
              className={
                timing === 'current'
                  ? 'rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'
                  : 'rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'
              }
            >
              {TIMING_LABEL[timing]}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <Section
            icon={<Megaphone className="h-4 w-4" />}
            title="Brief"
            action={
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> {isAdmin ? 'Editar' : 'Ver datos'}
              </Button>
            }
          >
            {campaign.goal || campaign.notes ? (
              <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
                {campaign.goal && (
                  <p>
                    <span className="font-medium">Objetivo:</span> {campaign.goal}
                  </p>
                )}
                {campaign.notes && <p className="whitespace-pre-wrap break-words">{campaign.notes}</p>}
              </div>
            ) : (
              <Empty>
                {isAdmin
                  ? 'Sin brief. En «Editar», «Usar plantilla de brief» pone las preguntas: qué ofrecemos, para quién, mensaje…'
                  : 'Todavía no hay brief.'}
              </Empty>
            )}
          </Section>

          <Section
            icon={<Target className="h-4 w-4" />}
            title="Objetivos"
            action={
              isAdmin && (
                <Button size="sm" variant="outline" onClick={onNewGoal}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Objetivo
                </Button>
              )
            }
          >
            {campaignGoals.length === 0 ? (
              <Empty>Sin objetivos.</Empty>
            ) : (
              <ul className="space-y-2">
                {campaignGoals.map((g) => {
                  const pct = goalProgress(g);
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => onSelectGoal(g)}
                        className="w-full space-y-1.5 rounded-md border p-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium">{g.title}</span>
                          <span className="font-semibold tabular-nums">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-2" aria-label={`Avance de ${g.title}`} />
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {formatGoalValue(g.metric, g.current, currency)} de{' '}
                          {formatGoalValue(g.metric, g.target, currency)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            icon={<ListChecks className="h-4 w-4" />}
            title={campaignTasks.length ? `Tareas · ${doneCount} de ${campaignTasks.length} hechas` : 'Tareas'}
            action={
              isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={addTemplate} disabled={addingTemplate}>
                    {addingTemplate ? 'Creando…' : 'Crear tareas de Black Friday'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={onNewTask}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Tarea
                  </Button>
                </div>
              )
            }
          >
            {campaignTasks.length === 0 ? (
              <Empty>
                {isAdmin
                  ? 'Sin tareas. «Crear tareas de Black Friday» pone la lista típica (precios en Shopify, emails, reels, escaparate…) con fechas; luego se reparten.'
                  : 'Sin tareas.'}
              </Empty>
            ) : (
              <ul className="divide-y rounded-md border">
                {campaignTasks.map((t) => {
                  const state = taskState(t, today);
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        checked={!!t.done_at}
                        disabled={!canToggleTask(t, currentUserId, isAdmin) || busyTask === t.id}
                        onCheckedChange={() => toggle(t)}
                        aria-label={t.done_at ? `Desmarcar «${t.title}»` : `Marcar «${t.title}» como hecha`}
                      />
                      <button type="button" onClick={() => onSelectTask(t)} className="min-w-0 flex-1 text-left">
                        <span
                          className={cn('block truncate text-sm', t.done_at && 'text-muted-foreground line-through')}
                        >
                          {t.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{name(t.assignee_id)}</span>
                      </button>
                      {t.due_on && (
                        <span
                          className={cn(
                            'whitespace-nowrap text-xs',
                            state === 'overdue' ? 'font-medium text-destructive' : 'text-muted-foreground',
                            state === 'today' && 'font-medium text-primary',
                          )}
                        >
                          {format(parseISO(t.due_on), 'd MMM', { locale: es })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section icon={<Megaphone className="h-4 w-4" />} title="Publicaciones">
            {campaignPosts.length === 0 ? (
              <Empty>Sin publicaciones. Al crear una publicación, elige esta campaña y saldrá aquí.</Empty>
            ) : (
              <ul className="divide-y rounded-md border">
                {campaignPosts.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelectPost(p)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                      <StatusBadge status={p.status} />
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {p.scheduled_at ? format(parseISO(p.scheduled_at), 'd MMM', { locale: es }) : 'Sin fecha'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
