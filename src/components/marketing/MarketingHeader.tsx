import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MarketingFilters, TeamMember } from '@/hooks/useMarketingPosts';
import { CONTENT_TYPE_LABEL, STATUS_LABEL, CHANNEL_LABEL } from './PostBadge';

interface MarketingHeaderProps {
  filters: MarketingFilters;
  onFiltersChange: (f: MarketingFilters) => void;
  onNewPost: () => void;
  canEdit: boolean;
  teamMembers: TeamMember[];
}

export function MarketingHeader({
  filters,
  onFiltersChange,
  onNewPost,
  canEdit,
  teamMembers,
}: MarketingHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendario de marketing</h1>
          <p className="text-muted-foreground">
            Planifica historias, posts y reels del equipo
          </p>
        </div>
        {canEdit && (
          <Button onClick={onNewPost}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva publicación
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={filters.contentType ?? 'all'}
          onValueChange={(v) =>
            onFiltersChange({ ...filters, contentType: v as MarketingFilters['contentType'] })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {(Object.keys(CONTENT_TYPE_LABEL) as Array<keyof typeof CONTENT_TYPE_LABEL>).map((t) => (
              <SelectItem key={t} value={t}>
                {CONTENT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.channel ?? 'all'}
          onValueChange={(v) =>
            onFiltersChange({ ...filters, channel: v as MarketingFilters['channel'] })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los canales</SelectItem>
            {(Object.keys(CHANNEL_LABEL) as Array<keyof typeof CHANNEL_LABEL>).map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? 'all'}
          onValueChange={(v) =>
            onFiltersChange({ ...filters, status: v as MarketingFilters['status'] })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.assigneeId ?? 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, assigneeId: v })}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Responsable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los responsables</SelectItem>
            {teamMembers.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name || 'Sin nombre'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
