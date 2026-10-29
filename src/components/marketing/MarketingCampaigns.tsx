import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarRange, Plus, Sparkles, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMoney } from '@/hooks/useMoney';
import {
  campaignColor,
  campaignTiming,
  formatGoalValue,
  goalProgress,
  GOAL_METRIC_LABEL,
  type CampaignTiming,
} from '@/lib/marketingPlan';
import type { MarketingCampaign, MarketingGoal, MarketingPost } from '@/types/database';

interface MarketingCampaignsProps {
  campaigns: MarketingCampaign[];
  goals: MarketingGoal[];
  posts: MarketingPost[];
  canEdit: boolean;
  onNewCampaign: () => void;
  onSelectCampaign: (c: MarketingCampaign) => void;
  onAddKeyDates: () => Promise<number>;
  onNewGoal: () => void;
  onSelectGoal: (g: MarketingGoal) => void;
}

const TIMING_LABEL: Record<CampaignTiming, string> = {
  current: 'En curso',
  upcoming: 'Próxima',
  past: 'Terminada',
};

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

function dateRange(starts_on: string, ends_on: string) {
  const a = parseISO(starts_on);
  if (starts_on === ends_on) return format(a, "EEE d 'de' MMM yyyy", { locale: es });
  return `${format(a, 'd MMM', { locale: es })} – ${format(parseISO(ends_on), 'd MMM yyyy', { locale: es })}`;
}

export function MarketingCampaigns({
  campaigns,
  goals,
  posts,
  canEdit,
  onNewCampaign,
  onSelectCampaign,
  onAddKeyDates,
  onNewGoal,
  onSelectGoal,
}: MarketingCampaignsProps) {
  const { currency } = useMoney();
  const [showPast, setShowPast] = useState(false);
  const [addingDates, setAddingDates] = useState(false);
  const today = todayKey();

  const postsByCampaign = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of posts) if (p.campaign_id) map.set(p.campaign_id, (map.get(p.campaign_id) ?? 0) + 1);
    return map;
  }, [posts]);

  const visibleCampaigns = campaigns.filter((c) => showPast || campaignTiming(c, today) !== 'past');
  const visibleGoals = goals.filter((g) => showPast || campaignTiming(g, today) !== 'past');

  const addDates = async () => {
    setAddingDates(true);
    try {
      await onAddKeyDates();
    } finally {
      setAddingDates(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end gap-2">
        <Switch id="ver-pasadas" checked={showPast} onCheckedChange={setShowPast} />
        <Label htmlFor="ver-pasadas" className="text-sm font-normal">
          Ver también lo terminado
        </Label>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="w-5 h-5" /> Objetivos
          </h2>
          {canEdit && (
            <Button size="sm" onClick={onNewGoal}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo objetivo
            </Button>
          )}
        </div>

        {visibleGoals.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Todavía no hay objetivos. Pon uno con una cifra meta, por ejemplo «Ventas de Black Friday».
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleGoals.map((g) => {
              const pct = goalProgress(g);
              const campaign = campaigns.find((c) => c.id === g.campaign_id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelectGoal(g)}
                  className="rounded-lg border bg-card p-4 text-left space-y-2 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium leading-tight">{g.title}</span>
                    <span className="text-sm font-semibold tabular-nums">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" aria-label={`Avance de ${g.title}`} />
                  <div className="text-sm tabular-nums">
                    {formatGoalValue(g.metric, g.current, currency)}{' '}
                    <span className="text-muted-foreground">de {formatGoalValue(g.metric, g.target, currency)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {GOAL_METRIC_LABEL[g.metric]} · {dateRange(g.starts_on, g.ends_on)}
                    {campaign && ` · ${campaign.name}`}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarRange className="w-5 h-5" /> Campañas y fechas clave
          </h2>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={addDates} disabled={addingDates}>
                <Sparkles className="mr-1 h-4 w-4" />
                {addingDates ? 'Añadiendo…' : 'Añadir fechas clave'}
              </Button>
              <Button size="sm" onClick={onNewCampaign}>
                <Plus className="mr-1 h-4 w-4" /> Nueva campaña
              </Button>
            </div>
          )}
        </div>

        {visibleCampaigns.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {canEdit
              ? 'Todavía no hay campañas. Con «Añadir fechas clave» se cargan Black Friday, Navidad, Rebajas, Fallas… de los próximos 12 meses.'
              : 'Todavía no hay campañas.'}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {visibleCampaigns.map((c) => {
              const timing = campaignTiming(c, today);
              const count = postsByCampaign.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCampaign(c)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: campaignColor(c) }} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{c.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {dateRange(c.starts_on, c.ends_on)}
                        {c.kind === 'key_date' ? ' · Fecha clave' : ''}
                        {c.goal ? ` · ${c.goal}` : ''}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {count} {count === 1 ? 'publicación' : 'publicaciones'}
                      </span>
                    )}
                    <span
                      className={
                        timing === 'current'
                          ? 'rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'
                          : 'rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {TIMING_LABEL[timing]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
