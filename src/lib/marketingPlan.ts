// Lógica pura de campañas y objetivos de marketing (franjas del calendario y avance).
import { formatMoney } from '@/lib/money';
import type { MarketingCampaign, MarketingGoal, MarketingGoalMetric } from '@/types/database';

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
