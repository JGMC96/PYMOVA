// Retail › Historial: ventas de la tienda hechas en Stockagile (0046), solo para consultar.
// No son ventas de PYMOVA: no se devuelven ni se reimprimen aquí.
import { Fragment, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBusiness } from '@/contexts/BusinessContext';
import { useStockagileSales } from '@/hooks/useStockagileSales';
import { eur } from '@/lib/clientHistory';
import { STOCKAGILE_PILOT_BUSINESS_ID } from '../../../supabase/functions/_shared/stockagile-core.ts';

export function StockagileSalesPanel() {
  const { activeBusinessId } = useBusiness();
  const enabled = activeBusinessId === STOCKAGILE_PILOT_BUSINESS_ID;
  const { sales, hasMore, isLoading, isSyncing, loadMore, syncNow } = useStockagileSales(enabled);
  const [open, setOpen] = useState<string | null>(null);

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Store className="w-5 h-5" />
            Ventas de la tienda en Stockagile
          </CardTitle>
          <CardDescription>
            Copia para consultar de los tickets hechos en Stockagile. Se actualiza sola cada 5 minutos y no mueve stock.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void syncNow()} disabled={isSyncing}>
          {isSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Actualizar
        </Button>
      </CardHeader>
      <CardContent>
        {sales.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground">Aún no hay ventas de Stockagile copiadas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Ticket</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s) => {
                const isOpen = open === s.id;
                return (
                  <Fragment key={s.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : s.id)}>
                      <TableCell>
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </TableCell>
                      <TableCell className="font-medium">
                        {s.number ?? '—'}
                        {s.is_return && (
                          <Badge variant="secondary" className="ml-2">
                            {Number(s.total) > 0 ? 'Cambio' : 'Devolución'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{format(new Date(s.sold_at), "d MMM yyyy, HH:mm", { locale: es })}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{s.clients?.name ?? s.customer_name ?? 'Mostrador'}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.payment_methods ?? '—'}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{eur(s.total)}</TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={5}>
                          <ul className="space-y-0.5 text-sm">
                            {s.stockagile_sale_items.map((i) => (
                              <li key={i.id} className="flex justify-between gap-2">
                                <span>{Math.abs(Number(i.quantity)) !== 1 ? `${i.quantity} × ` : ''}{i.product_name}</span>
                                {i.total != null && <span className="tabular-nums text-muted-foreground">{eur(i.total)}</span>}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
        {(hasMore || isLoading) && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cargar más
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
