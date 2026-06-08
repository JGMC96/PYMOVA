import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil, Eye } from 'lucide-react';
import type { MarketingPost } from '@/types/database';
import type { TeamMember } from '@/hooks/useMarketingPosts';
import { TypeBadge, StatusBadge, ChannelsBadges } from './PostBadge';

interface MarketingListProps {
  posts: MarketingPost[];
  isLoading: boolean;
  teamMembers: TeamMember[];
  onSelect: (post: MarketingPost) => void;
  canEdit: boolean;
}

export function MarketingList({
  posts,
  isLoading,
  teamMembers,
  onSelect,
  canEdit,
}: MarketingListProps) {
  const memberName = (id: string | null) => {
    if (!id) return '—';
    const m = teamMembers.find((t) => t.user_id === id);
    return m?.full_name || 'Sin nombre';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
        No hay publicaciones que coincidan con los filtros.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Título</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Canales</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Responsable</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="text-sm whitespace-nowrap">
                {p.scheduled_at
                  ? format(new Date(p.scheduled_at), "d MMM yyyy · HH:mm", { locale: es })
                  : <span className="text-muted-foreground">Sin fecha</span>}
              </TableCell>
              <TableCell className="font-medium">{p.title}</TableCell>
              <TableCell>
                <TypeBadge type={p.content_type} />
              </TableCell>
              <TableCell>
                <ChannelsBadges channels={p.channels} />
              </TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-sm">{memberName(p.assignee_id)}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => onSelect(p)}>
                  {canEdit ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
