import { Image, Film, Camera, Instagram, Facebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  MarketingContentType,
  MarketingChannel,
  MarketingStatus,
} from '@/types/database';

export const CONTENT_TYPE_LABEL: Record<MarketingContentType, string> = {
  story: 'Historia',
  post: 'Post',
  reel: 'Reel',
};

export const STATUS_LABEL: Record<MarketingStatus, string> = {
  idea: 'Idea',
  draft: 'Borrador',
  scheduled: 'Programado',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

export const CHANNEL_LABEL: Record<MarketingChannel, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
};

const CONTENT_TYPE_CLASSES: Record<MarketingContentType, string> = {
  story: 'bg-accent/15 text-accent border-accent/30',
  post: 'bg-primary/15 text-primary border-primary/30',
  reel: 'bg-secondary text-secondary-foreground border-border',
};

const STATUS_CLASSES: Record<MarketingStatus, string> = {
  idea: 'bg-muted text-muted-foreground border-border',
  draft: 'bg-secondary text-secondary-foreground border-border',
  scheduled: 'bg-primary/15 text-primary border-primary/30',
  published: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function ContentTypeIcon({ type, className }: { type: MarketingContentType; className?: string }) {
  const Icon = type === 'story' ? Camera : type === 'reel' ? Film : Image;
  return <Icon className={cn('w-3.5 h-3.5', className)} />;
}

export function ChannelIcon({ channel, className }: { channel: MarketingChannel; className?: string }) {
  const Icon = channel === 'instagram' ? Instagram : Facebook;
  return <Icon className={cn('w-3.5 h-3.5', className)} />;
}

export function TypeBadge({ type }: { type: MarketingContentType }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        CONTENT_TYPE_CLASSES[type]
      )}
    >
      <ContentTypeIcon type={type} />
      {CONTENT_TYPE_LABEL[type]}
    </span>
  );
}

export function StatusBadge({ status }: { status: MarketingStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ChannelsBadges({ channels }: { channels: MarketingChannel[] }) {
  if (!channels?.length) return null;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {channels.map((c) => (
        <ChannelIcon key={c} channel={c} />
      ))}
    </span>
  );
}
