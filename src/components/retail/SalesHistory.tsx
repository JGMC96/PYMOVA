import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Receipt, CreditCard, Banknote, RefreshCw, RotateCcw } from 'lucide-react';
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
import { useRetailSales } from '@/hooks/useRetailSales';
import { useSaleReturns, type SaleReturn } from '@/hooks/useSaleReturns';
import { ReturnDialog } from './ReturnDialog';

export function SalesHistory() {
  const { sales, isLoading, refreshSales } = useRetailSales();
  const { fetchReturns } = useSaleReturns();
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [selectedSale, setSelectedSale] = useState<{ id: string; number: string } | null>(null);

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
      default:
        return method || 'N/A';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          Historial de Ventas
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
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : sales.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No hay ventas registradas</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead># Venta</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => {
                const refunded = returnedTotal(sale.id);
                return (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {sale.sale_number}
                        {refunded > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            −{refunded.toFixed(2)} €
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(new Date(sale.created_at), 'dd MMM yyyy HH:mm', { locale: es })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sale.client_name}</Badge>
                    </TableCell>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedSale({ id: sale.id, number: sale.sale_number })}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Devolver
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ReturnDialog
        open={!!selectedSale}
        onOpenChange={(open) => !open && setSelectedSale(null)}
        saleId={selectedSale?.id ?? null}
        saleNumber={selectedSale?.number}
        onCompleted={() => {
          loadReturns();
          refreshSales();
        }}
      />
    </Card>
  );
}
