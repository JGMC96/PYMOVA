// Retail › Historial: ventas de la tienda hechas en Stockagile (0046), solo para consultar.
// No son ventas de PYMOVA: no se devuelven aquí, pero se puede imprimir un duplicado.
// El buscador es el de «Ventas en PYMOVA»: al escribir filtra los tickets cargados y con Intro
// (o el lector) busca en todos; lo encontrado llega en `found`.
import { Fragment, useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronDown, ChevronRight, Loader2, Printer, RefreshCw, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBusiness } from '@/contexts/BusinessContext';
import { STOCKAGILE_SEARCH_LIMIT, useStockagileSales, type StockagileSale } from '@/hooks/useStockagileSales';
import { eur } from '@/lib/clientHistory';
import { matchesStockagileNumber } from '@/lib/ticketCode';
import { STOCKAGILE_PILOT_BUSINESS_ID } from '../../../supabase/functions/_shared/stockagile-core.ts';
import { StockagileReprintDialog } from './StockagileReprintDialog';

interface StockagileSalesPanelProps {
  /** Lo que se está escribiendo en el buscador de Historial. */
  query?: string;
  /** Tickets encontrados al buscar en todos (Intro o lector); null sin búsqueda. */
  found?: StockagileSale[] | null;
  onClearSearch?: () => void;
}

export function StockagileSalesPanel({ query = '', found = null, onClearSearch }: StockagileSalesPanelProps) {
  const { activeBusinessId } = useBusiness();
  const enabled = activeBusinessId === STOCKAGILE_PILOT_BUSINESS_ID;
  const { sales, hasMore, isLoading, isSyncing, loadMore, syncNow } = useStockagileSales(enabled);
  const [open, setOpen] = useState<string | null>(null);
  const [reprintId, setReprintId] = useState<string | null>(null);
  const closeReprint = useCallback(() => setReprintId(null), []);
  const visible = useMemo(
    () => found ?? (query.trim() ? sales.filter((s) => matchesStockagileNumber(s.number, query)) : sales),
    [found, query, sales],
  );

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
            Se puede imprimir un duplicado; las devoluciones de estos tickets aún se hacen en Stockagile.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void syncNow()} disabled={isSyncing}>
          {isSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Actualizar
        </Button>
      </CardHeader>
      <CardContent>
        {found && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <Badge variant="secondary">
              {found.length === 1 ? 'Ticket encontrado' : `${found.length} tickets encontrados`} en Stockagile
            </Badge>
            {found.length >= STOCKAGILE_SEARCH_LIMIT && (
              <span className="text-xs text-muted-foreground">Los más recientes; escribe más cifras para afinar.</span>
            )}
            {onClearSearch && (
              <Button variant="ghost" size="sm" onClick={onClearSearch}>
                Ver todos
              </Button>
            )}
          </div>
        )}
        {sales.length === 0 && !isLoading && !found ? (
          <p className="text-sm text-muted-foreground">Aún no hay ventas de Stockagile copiadas.</p>
        ) : visible.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground">
            Ningún ticket cargado coincide. Pulsa Intro en el buscador de arriba para buscarlo entre todos.
          </p>
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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => {
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
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Imprimir duplicado del ticket ${s.number ?? ''}`}
                          title="Imprimir duplicado"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReprintId(s.id);
                          }}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={6}>
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
        {!found && (hasMore || isLoading) && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cargar más
            </Button>
          </div>
        )}
      </CardContent>
      <StockagileReprintDialog saleId={reprintId} onClose={closeReprint} />
    </Card>
  );
}
