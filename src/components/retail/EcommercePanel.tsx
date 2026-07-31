import { useMemo, useState } from 'react';
import {
  Ban, Check, Loader2, Package, PackageCheck, RefreshCw, RotateCcw, ShoppingBag, Truck,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useOnlineOrders, ORDER_STATUS_LABEL, type OnlineOrder, type OnlineOrderStatus,
} from '@/hooks/useOnlineOrders';
import { useShopifyOrdersSync } from '@/hooks/useShopifyOrdersSync';
import { OnlineOrderDialog } from './OnlineOrderDialog';
import { OnlineOrderReturnDialog } from './OnlineOrderReturnDialog';

const STATUS_STYLES: Record<OnlineOrderStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-500 hover:bg-amber-500/15',
  accepted: 'bg-sky-500/15 text-sky-500 hover:bg-sky-500/15',
  preparing: 'bg-indigo-500/15 text-indigo-500 hover:bg-indigo-500/15',
  shipped: 'bg-cyan-500/15 text-cyan-500 hover:bg-cyan-500/15',
  delivered: 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15',
  cancelled: 'bg-destructive/15 text-destructive hover:bg-destructive/15',
  returned: 'bg-muted text-muted-foreground hover:bg-muted',
};

const NEXT_ACTION: Partial<Record<OnlineOrderStatus, { next: OnlineOrderStatus; label: string; icon: typeof Check }>> = {
  pending: { next: 'accepted', label: 'Aceptar', icon: Check },
  accepted: { next: 'preparing', label: 'Preparar', icon: Package },
  preparing: { next: 'shipped', label: 'Enviar', icon: Truck },
  shipped: { next: 'delivered', label: 'Entregado', icon: PackageCheck },
};

const currency = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value || 0);

export function EcommercePanel() {
  const {
    orders, isLoading, isSubmitting, statusFilter, setStatusFilter,
    createOrder, setStatus, createReturn, fetchOrders,
  } = useOnlineOrders();

  const { isSyncing: isShopifySyncing, syncOrders: runShopifySync, diagnose: diagnoseShopify } =
    useShopifyOrdersSync();

  const syncShopifyOrders = async (days: number) => {
    const result = await runShopifySync(days);
    if (result) await fetchOrders();
  };



  const [isFormOpen, setIsFormOpen] = useState(false);
  const [returnOrder, setReturnOrder] = useState<OnlineOrder | null>(null);

  const stats = useMemo(() => {
    const pending = orders.filter((o) => o.status === 'pending').length;
    const inProgress = orders.filter((o) => ['accepted', 'preparing', 'shipped'].includes(o.status)).length;
    const revenue = orders
      .filter((o) => !['cancelled', 'returned'].includes(o.status))
      .reduce((sum, o) => sum + Number(o.total), 0);
    return { pending, inProgress, revenue };
  }, [orders]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Pedidos por aceptar</p>
            <p className="text-2xl font-bold">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">En curso</p>
            <p className="text-2xl font-bold">{stats.inProgress}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Facturación online</p>
            <p className="text-2xl font-bold">{currency(stats.revenue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-accent" />
              Pedidos online
            </CardTitle>
            <CardDescription>
              Acepta pedidos, actualiza su estado y gestiona cambios y devoluciones. El stock se
              descuenta al aceptar y se repone al cancelar o devolver.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OnlineOrderStatus | 'all')}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(Object.keys(ORDER_STATUS_LABEL) as OnlineOrderStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{ORDER_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => syncShopifyOrders(30)} disabled={isShopifySyncing}>
              {isShopifySyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar Shopify
            </Button>
            <Button variant="ghost" onClick={() => diagnoseShopify()}>
              Comprobar permisos
            </Button>
            <Button onClick={() => setIsFormOpen(true)}>Nuevo pedido</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              Aún no hay pedidos online registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Artículos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const action = NEXT_ACTION[order.status];
                    const ActionIcon = action?.icon;
                    const closed = ['cancelled', 'returned'].includes(order.status);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.order_number}
                          <span className="block text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString('es-ES')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {order.customer_name}
                          {order.customer_email && (
                            <span className="block text-xs text-muted-foreground">{order.customer_email}</span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline">{order.source}</Badge></TableCell>
                        <TableCell>{order.online_order_items?.length ?? 0}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_STYLES[order.status]}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{currency(Number(order.total))}</TableCell>
                        <TableCell className="text-right space-x-1 whitespace-nowrap">
                          {action && ActionIcon && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isSubmitting}
                              onClick={() => setStatus(order.id, action.next)}
                            >
                              <ActionIcon className="w-3.5 h-3.5 mr-1.5" />
                              {action.label}
                            </Button>
                          )}
                          {!closed && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isSubmitting}
                                onClick={() => setReturnOrder(order)}
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                Devolver
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isSubmitting}
                                onClick={() => setStatus(order.id, 'cancelled')}
                              >
                                <Ban className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OnlineOrderDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={createOrder}
        isSubmitting={isSubmitting}
      />
      <OnlineOrderReturnDialog
        order={returnOrder}
        onOpenChange={(open) => !open && setReturnOrder(null)}
        isSubmitting={isSubmitting}
        onSubmit={createReturn}
      />
    </div>
  );
}
