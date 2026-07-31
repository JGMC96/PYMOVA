import { AlertCircle, CheckCircle2, Loader2, RotateCw, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { QueueItem, QueueState, SyncIssue } from '@/hooks/useShopifyImport';

interface Props {
  queue: QueueState;
  issues: SyncIssue[];
  isSyncing: boolean;
  fetchedCount: number;
  onCancel: () => void;
}

const statusIcon = (item: QueueItem) => {
  switch (item.status) {
    case 'done':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    case 'retrying':
      return <RotateCw className="w-4 h-4 text-amber-500 animate-spin shrink-0" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />;
    default:
      return <span className="w-4 h-4 rounded-full border border-muted-foreground/30 shrink-0" />;
  }
};

export const SyncQueuePanel = ({ queue, issues, isSyncing, fetchedCount, onCancel }: Props) => {
  if (queue.phase === 'idle' && issues.length === 0) return null;

  const percent = queue.total > 0 ? Math.round((queue.processed / queue.total) * 100) : 0;
  const activeItems = queue.items.filter((i) => i.status !== 'pending' || queue.total <= 50);
  const unresolved = issues.filter((i) => !i.resolved);
  const retried = issues.filter((i) => i.resolved);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Cola de sincronización</CardTitle>
          <CardDescription>
            {queue.phase === 'fetching'
              ? `Descargando catálogo de Shopify… ${fetchedCount} productos leídos.`
              : queue.phase === 'processing'
                ? `Procesando ${queue.processed} de ${queue.total} productos (hasta 3 intentos por producto).`
                : `Última ejecución: ${queue.succeeded} correctos · ${queue.failed} con error.`}
          </CardDescription>
        </div>
        {isSyncing && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {queue.total > 0 && (
          <div className="space-y-2">
            <Progress value={queue.phase === 'done' ? 100 : percent} />
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{queue.processed}/{queue.total} procesados</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                {queue.succeeded} correctos
              </Badge>
              {queue.failed > 0 && <Badge variant="destructive">{queue.failed} con error</Badge>}
            </div>
          </div>
        )}

        {activeItems.length > 0 && (
          <ScrollArea className="h-48 rounded-md border">
            <ul className="divide-y text-sm">
              {activeItems.map((item) => (
                <li key={item.id} className="flex items-start gap-2 px-3 py-2">
                  {statusIcon(item)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{item.name}</p>
                    {item.error && (
                      <p className="text-xs text-destructive break-words">{item.error}</p>
                    )}
                  </div>
                  {item.attempts > 1 && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {item.attempts} intentos
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        {(unresolved.length > 0 || retried.length > 0) && (
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Detalle de incidencias ({unresolved.length} sin resolver
              {retried.length > 0 ? `, ${retried.length} resueltas tras reintento` : ''})
            </p>
            <ScrollArea className="max-h-56 rounded-md border">
              <ul className="divide-y text-sm">
                {[...unresolved, ...retried].map((issue) => (
                  <li key={issue.id} className="px-3 py-2 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant={issue.entity_type === 'variant' ? 'outline' : 'secondary'}>
                        {issue.entity_type === 'variant' ? 'Variante' : 'Producto'}
                      </Badge>
                      <span className="truncate font-medium">{issue.entity_name}</span>
                      <Badge
                        variant={issue.resolved ? 'default' : 'destructive'}
                        className="ml-auto shrink-0"
                      >
                        {issue.resolved ? 'Resuelta' : `${issue.attempts} intentos`}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">
                      {issue.error_message}
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
