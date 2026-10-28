import { Lightbulb, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MarketingCampaign, MarketingPost } from '@/types/database';
import type { TeamMember } from '@/hooks/useMarketingPosts';
import { ChannelsBadges, TypeBadge } from './PostBadge';

interface MarketingIdeasProps {
  posts: MarketingPost[];
  teamMembers: TeamMember[];
  campaigns: MarketingCampaign[];
  onNew: () => void;
  onSelect: (post: MarketingPost) => void;
}

/** Tablero de ideas: las publicaciones en estado «idea». Cualquiera del equipo apunta las suyas. */
export function MarketingIdeas({ posts, teamMembers, campaigns, onNew, onSelect }: MarketingIdeasProps) {
  const ideas = posts.filter((p) => p.status === 'idea');
  const name = (id: string | null) => (id ? teamMembers.find((m) => m.user_id === id)?.full_name || 'Sin nombre' : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Apunta aquí cualquier idea. Cuando guste, un administrador la pone en fecha y pasa al calendario.
        </p>
        <Button size="sm" onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" /> Nueva idea
        </Button>
      </div>

      {ideas.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          <Lightbulb className="mx-auto mb-2 h-6 w-6" />
          Todavía no hay ideas.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ideas.map((p) => {
            const author = name(p.created_by);
            const campaign = p.campaign_id ? campaigns.find((c) => c.id === p.campaign_id)?.name : undefined;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className="rounded-lg border bg-card p-4 text-left space-y-2 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <TypeBadge type={p.content_type} />
                  <ChannelsBadges channels={p.channels} />
                </div>
                <div className="font-medium leading-tight">{p.title}</div>
                {p.copy && <p className="line-clamp-3 text-sm text-muted-foreground">{p.copy}</p>}
                <div className="text-xs text-muted-foreground">
                  {author ? `Propuesta por ${author}` : 'Sin autor'}
                  {campaign && ` · ${campaign}`}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
