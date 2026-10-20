import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useShopifyProblems } from '@/hooks/useShopifyProblems';
import { KIND_LABEL, STATE_LABEL, failedCount } from '@/lib/shopifyProblems';

/** Integraciones › Shopify: ventas, devoluciones, stock y avisos que no han llegado a Shopify. */
export function ShopifyProblemsPanel() {
  const { problems, isLoading, isRetrying, refresh, retry, enabled } = useShopifyProblems();
  if (!enabled) return null;
  const failed = failedCount(problems);

  return (
    <Card className={failed > 0 ? 'border-destructive/40' : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            {failed > 0 ? (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            )}
            Envíos a Shopify
          </CardTitle>
          <CardDescription>
            Ventas, devoluciones y cambios de stock de Pymova que Shopify no ha aceptado, y avisos de Shopify
            que no se han podido procesar. Se reintentan solos cada 5 minutos hasta 5 veces; después quedan aquí.
          </CardDescription>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isLoading} aria-label="Actualizar">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={() => void retry()} disabled={isRetrying || failed === 0}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{isLoading ? 'Cargando…' : 'Todo se ha enviado correctamente.'}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Intentos</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {problems.map((p) => (
                <TableRow key={`${p.kind}-${p.record_id}`}>
                  <TableCell>{KIND_LABEL[p.kind]}</TableCell>
                  <TableCell className="font-medium">{p.reference ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={p.state === 'failed' ? 'destructive' : 'secondary'}>{STATE_LABEL[p.state]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground break-words">{p.error ?? '—'}</TableCell>
                  <TableCell className="text-right">{p.attempts}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(p.happened_at), 'dd MMM HH:mm', { locale: es })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
