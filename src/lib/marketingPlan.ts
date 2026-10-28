// Lógica pura del plan de marketing: franjas de campañas, avance de objetivos y tareas.
import { formatMoney } from '@/lib/money';
import type { MarketingCampaign, MarketingGoal, MarketingGoalMetric, MarketingTask } from '@/types/database';

export const GOAL_METRIC_LABEL: Record<MarketingGoalMetric, string> = {
  sales: 'Ventas',
  followers: 'Seguidores nuevos',
  reach: 'Alcance',
  engagement: 'Interacciones',
  email_subscribers: 'Suscriptores de email',
  other: 'Otro',
};

export const CAMPAIGN_COLORS = ['#6366f1', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#ec4899', '#111827'];

const DEFAULT_COLOR: Record<MarketingCampaign['kind'], string> = {
  campaign: '#6366f1',
  key_date: '#64748b',
};

export const campaignColor = (c: Pick<MarketingCampaign, 'color' | 'kind'>) => c.color || DEFAULT_COLOR[c.kind];

/** Campañas que cubren un día (AAAA-MM-DD): primero las más largas, para que las franjas no salten. */
export function campaignsOnDay(campaigns: MarketingCampaign[], day: string): MarketingCampaign[] {
  const length = (c: MarketingCampaign) => Date.parse(c.ends_on) - Date.parse(c.starts_on);
  return campaigns
    .filter((c) => c.starts_on <= day && day <= c.ends_on)
    .sort((a, b) => length(b) - length(a) || a.starts_on.localeCompare(b.starts_on) || a.name.localeCompare(b.name));
}

/** Avance de un objetivo en % (0-100, redondeado). */
export function goalProgress(goal: Pick<MarketingGoal, 'target' | 'current'>): number {
  if (!(goal.target > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((goal.current / goal.target) * 100)));
}

/** Cifra de un objetivo: importe en la moneda del negocio para ventas, número para lo demás. */
export function formatGoalValue(metric: MarketingGoalMetric, value: number, currency: string): string {
  if (metric === 'sales') return formatMoney(value, currency);
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

export type CampaignTiming = 'past' | 'current' | 'upcoming';

export function campaignTiming(c: Pick<MarketingCampaign, 'starts_on' | 'ends_on'>, today: string): CampaignTiming {
  if (c.ends_on < today) return 'past';
  if (c.starts_on > today) return 'upcoming';
  return 'current';
}

/** Estado de una tarea respecto a hoy (AAAA-MM-DD). */
export type TaskState = 'done' | 'overdue' | 'today' | 'pending';

export function taskState(t: Pick<MarketingTask, 'done_at' | 'due_on'>, today: string): TaskState {
  if (t.done_at) return 'done';
  if (t.due_on && t.due_on < today) return 'overdue';
  if (t.due_on === today) return 'today';
  return 'pending';
}

/** Orden de la lista: vencidas, de hoy, pendientes por fecha (sin fecha al final) y hechas. */
export function sortTasks<T extends Pick<MarketingTask, 'done_at' | 'due_on' | 'created_at'>>(tasks: T[], today: string): T[] {
  const rank: Record<TaskState, number> = { overdue: 0, today: 1, pending: 2, done: 3 };
  return [...tasks].sort((a, b) => {
    const r = rank[taskState(a, today)] - rank[taskState(b, today)];
    if (r) return r;
    if (a.done_at && b.done_at) return b.done_at.localeCompare(a.done_at);
    if (a.due_on !== b.due_on) return (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999');
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Una tarea la puede marcar su responsable o un administrador (lo comprueba también la RPC). */
export const canToggleTask = (t: Pick<MarketingTask, 'assignee_id'>, userId: string | null, isAdmin: boolean) =>
  isAdmin || (!!userId && t.assignee_id === userId);
