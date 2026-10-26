import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Receipt, CreditCard, Banknote, Mail, Printer, RefreshCw, RotateCcw, ScanLine, UserRoundPen, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { normalizeTicketCode, pymovaTicketCode, stockagileTicketCode } from '@/lib/ticketCode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useRetailSales, type SaleWithClient } from '@/hooks/useRetailSales';
import { useSaleReturns, type SaleReturn } from '@/hooks/useSaleReturns';
import { ReturnDialog } from './ReturnDialog';
import { RefundTicketDialog } from './RefundTicketDialog';
import { SendReceiptDialog } from './SendReceiptDialog';
import { SaleReprintDialog } from './SaleReprintDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ReassignSellerDialog } from './ReassignSellerDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';

const ALL_SELLERS = '__all__';
const NO_SELLER = '__none__';

interface SalesHistoryProps {
  /** Lo que se escribe en el buscador, para filtrar también otros historiales (Stockagile). */
  onQueryChange?: (query: string) => void;
  /** Busca el ticket en otro historial si no es de PYMOVA; true si lo encuentra. */
  searchElsewhere?: (query: string) => Promise<boolean>;
}

export function SalesHistory({ onQueryChange, searchElsewhere }: SalesHistoryProps = {}) {
  const { sales, isLoading, refreshSales, findSaleByTicket } = useRetailSales();
  const [query, setQueryState] = useState('');
  const [found, setFound] = useState<SaleWithClient | null>(null);
  const [foundElsewhere, setFoundElsewhere] = useState(false);
  const [searching, setSearching] = useState(false);
  const setQuery = (q: string) => {
    setQueryState(q);
    onQueryChange?.(q);
  };
  const { employees } = useSellerSession();
  const { isAdmin } = useRoleAccess('admin');
  const [sellerFilter, setSellerFilter] = useState(ALL_SELLERS);
  const [reassign, setReassign] = useState<{ id: string; number: string; sellerEmployeeId: string | null } | null>(null);
  const [emailFor, setEmailFor] = useState<{ id: string; number: string } | null>(null);
  const [reprintId, setReprintId] = useState<string | null>(null);
  const closeReprint = useCallback(() => setReprintId(null), []);
  const sellerName = (id: string | null | undefined) => (id ? (employees.find((e) => e.id === id)?.name ?? '—') : '—');

  // Mientras se escribe, se filtran las ventas cargadas; con Intro (lo que manda el
  // lector de códigos de barras) se busca el ticket exacto, aunque sea antiguo.
  const visibleSales = useMemo(() => {
    if (found) return [found];
    const bySeller =
      sellerFilter === ALL_SELLERS
        ? sales
        : sales.filter((s) => (sellerFilter === NO_SELLER ? !s.seller_employee_id : s.seller_employee_id === sellerFilter));
    const q = query.trim().toUpperCase();
    if (!q) return bySeller;
    const code = normalizeTicketCode(q);
    return bySeller.filter((s) => s.sale_number.includes(q) || (code !== null && s.sale_number === code));
  }, [sales, query, found, sellerFilter]);

  // Primero en PYMOVA (VTA-…, DEV-…); si no está o es un número de Stockagile (VT…), allí.
  const searchTicket = async () => {
    const code = pymovaTicketCode(query);
    const other = searchElsewhere ? stockagileTicketCode(query) : null;
    if (!code && !other) {
      toast.error('No es un número de ticket válido');
      return;
    }
    setFoundElsewhere(false);
    if (code) {
      const local = sales.find((s) => s.sale_number === code);
      if (local) {
        setFound(local);
        setQuery(code);
        return;
      }
      setSearching(true);
      const sale = await findSaleByTicket(code);
      setSearching(false);
      if (sale) {
        setFound(sale);
        setQuery(code);
        return;
      }
    }
    if (other && searchElsewhere) {
      setSearching(true);
      const ok = await searchElsewhere(query);
      setSearching(false);
      if (ok) {
        setFoundElsewhere(true);
        return;
      }
    }
    toast.error(`No se encuentra el ticket ${code ?? other}`);
  };

  const clearSearch = () => {
    setQuery('');
    setFound(null);
    setFoundElsewhere(false);
  };
  const { fetchReturns } = useSaleReturns();
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [selectedSale, setSelectedSale] = useState<{ id: string; number: string } | null>(null);
  // Ticket de abono abierto: recién registrado (se imprime solo) o reimpresión desde la lista.
  const [refundTicket, setRefundTicket] = useState<{ id: string; justCreated: boolean } | null>(null);

  const loadReturns = useCallback(() => {
    fetchReturns().then(setReturns);
  }, [fetchReturns]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  const returnedTotal = (saleId: string) =>
    returns.filter((r) => r.sale_id === saleId).reduce((sum, r) => sum + Number(r.total), 0);

  const getPaymentIcon = (method: string | null) => {
    switch (method) {
      case 'card':
        return <CreditCard className="w-4 h-4" />;
      case 'cash':
      default:
        return <Banknote className="w-4 h-4" />;
    }
  };

  const getPaymentLabel = (method: string | null) => {
    switch (method) {
      case 'card':
        return 'Tarjeta';
      case 'cash':
        return 'Efectivo';
      case 'transfer':
        return 'Transferencia';
      case 'store_credit':
        return 'Vale';
      default:
        return method || 'N/A';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          Ventas en PYMOVA
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refreshSales();
            loadReturns();
          }}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualizar
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFound(null);
              setFoundElsewhere(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void searchTicket();
              } else if (e.key === 'Escape') {
                clearSearch();
              }
            }}
            placeholder={
              searchElsewhere
                ? 'Escanea el ticket o escribe su número (VTA-000123 o, de Stockagile, VT2510383)'
                : 'Escanea el código del ticket o escribe su número (VTA-000123)'
            }
            className="pl-9 pr-9"
            aria-label="Buscar ticket"
            disabled={searching}
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {employees.length > 0 && (
          <Select value={sellerFilter} onValueChange={setSellerFilter}>
            <SelectTrigger className="sm:w-56" aria-label="Filtrar por vendedor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SELLERS}>Todos los vendedores</SelectItem>
              <SelectItem value={NO_SELLER}>Sin vendedor</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : visibleSales.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>
              {foundElsewhere
                ? 'No es un ticket de PYMOVA: está en «Ventas de la tienda en Stockagile», más abajo.'
                : query
                  ? 'Ningún ticket coincide. Pulsa Intro para buscarlo entre todos.'
                  : 'No hay ventas registradas'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead># Venta</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSales.map((sale) => {
                const refunded = returnedTotal(sale.id);
                return (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {sale.sale_number}
                        {refunded > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" aria-label="Devoluciones de esta venta">
                                <Badge variant="destructive" className="text-xs cursor-pointer">
                                  −{refunded.toFixed(2)} €
                                </Badge>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuLabel>Reimprimir abono</DropdownMenuLabel>
                              {returns
                                .filter((r) => r.sale_id === sale.id)
                                .map((r) => (
                                  <DropdownMenuItem
                                    key={r.id}
                                    onSelect={() => setRefundTicket({ id: r.id, justCreated: false })}
                                  >
                                    {r.return_number} · −{Number(r.total).toFixed(2)} €
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(new Date(sale.created_at), 'dd MMM yyyy HH:mm', { locale: es })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sale.client_name}</Badge>
                    </TableCell>
                    <TableCell>{sellerName(sale.seller_employee_id)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getPaymentIcon(sale.payment_method)}
                        <span>{getPaymentLabel(sale.payment_method)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {Number(sale.total).toFixed(2)} €
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setReassign({ id: sale.id, number: sale.sale_number, sellerEmployeeId: sale.seller_employee_id ?? null })
                            }
                            aria-label="Cambiar vendedor"
                            title="Cambiar vendedor"
                          >
                            <UserRoundPen className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReprintId(sale.id)}
                          aria-label="Reimprimir ticket"
                          title="Reimprimir ticket"
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEmailFor({ id: sale.id, number: sale.sale_number })}
                          aria-label="Enviar ticket por correo"
                          title="Enviar ticket por correo"
                        >
                          <Mail className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSale({ id: sale.id, number: sale.sale_number })}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Devolver
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ReassignSellerDialog
        open={!!reassign}
        onOpenChange={(open) => !open && setReassign(null)}
        sale={reassign}
        onCompleted={() => refreshSales()}
      />
      <ReturnDialog
        open={!!selectedSale}
        onOpenChange={(open) => !open && setSelectedSale(null)}
        saleId={selectedSale?.id ?? null}
        saleNumber={selectedSale?.number}
        onCompleted={() => {
          loadReturns();
          refreshSales();
        }}
        onReturned={(id) => setRefundTicket({ id, justCreated: true })}
      />
      <SendReceiptDialog sale={emailFor} onClose={() => setEmailFor(null)} onClientChanged={() => refreshSales()} />
      <SaleReprintDialog saleId={reprintId} onClose={closeReprint} />
      <RefundTicketDialog
        returnId={refundTicket?.id ?? null}
        justCreated={refundTicket?.justCreated}
        onClose={() => setRefundTicket(null)}
      />
    </Card>
  );
}
