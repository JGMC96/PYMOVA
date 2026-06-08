import { useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MarketingPost } from '@/types/database';
import { ContentTypeIcon, ChannelsBadges } from './PostBadge';

interface MarketingCalendarProps {
  posts: MarketingPost[];
  onSelectPost: (post: MarketingPost) => void;
  onSelectDay: (date: Date) => void;
  canEdit: boolean;
}

const CONTENT_TYPE_DOT: Record<MarketingPost['content_type'], string> = {
  story: 'bg-accent text-accent-foreground',
  post: 'bg-primary text-primary-foreground',
  reel: 'bg-secondary text-secondary-foreground border border-border',
};

export function MarketingCalendar({
  posts,
  onSelectPost,
  onSelectDay,
  canEdit,
}: MarketingCalendarProps) {
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, MarketingPost[]>();
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const key = format(new Date(p.scheduled_at), 'yyyy-MM-dd');
      const arr = map.get(key) || [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [posts]);

  const unscheduled = useMemo(() => posts.filter((p) => !p.scheduled_at), [posts]);

  const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize">
          {format(cursor, 'MMMM yyyy', { locale: es })}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor(subMonths(cursor, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Hoy
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {weekdays.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-xs font-medium text-muted-foreground text-center"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const dayPosts = postsByDay.get(key) || [];
            const inMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, today);

            return (
              <div
                key={key}
                className={cn(
                  'min-h-[110px] border-b border-r p-1.5 flex flex-col gap-1 transition-colors',
                  !inMonth && 'bg-muted/20 text-muted-foreground',
                  canEdit && 'cursor-pointer hover:bg-muted/40'
                )}
                onClick={() => canEdit && onSelectDay(day)}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'text-xs font-medium w-6 h-6 inline-flex items-center justify-center rounded-full',
                      isToday && 'bg-primary text-primary-foreground'
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="space-y-1 overflow-hidden">
                  {dayPosts.slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPost(p);
                      }}
                      className={cn(
                        'w-full text-left rounded px-1.5 py-1 text-[11px] leading-tight flex items-center gap-1 truncate',
                        CONTENT_TYPE_DOT[p.content_type],
                        'hover:opacity-90'
                      )}
                      title={p.title}
                    >
                      <ContentTypeIcon type={p.content_type} className="w-3 h-3 shrink-0" />
                      <span className="truncate flex-1">{p.title}</span>
                      <ChannelsBadges channels={p.channels} />
                    </button>
                  ))}
                  {dayPosts.length > 3 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      +{dayPosts.length - 3} más
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Sin fecha programada</h3>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPost(p)}
                className={cn(
                  'rounded px-2 py-1 text-xs flex items-center gap-1.5',
                  CONTENT_TYPE_DOT[p.content_type],
                  'hover:opacity-90'
                )}
              >
                <ContentTypeIcon type={p.content_type} className="w-3 h-3" />
                {p.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
