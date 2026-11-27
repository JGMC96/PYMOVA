import { useEffect, useState } from 'react';
import { Loader2, Truck } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { OnlineOrder, ShipmentDetails } from '@/hooks/useOnlineOrders';

interface Props {
  order: OnlineOrder | null;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (orderId: string, shipment: ShipmentDetails) => Promise<boolean>;
}

/** «Enviar»: transportista, número de seguimiento y aviso a la clienta (en los de Shopify). */
export function ShipOrderDialog({ order, onOpenChange, isSubmitting, onSubmit }: Props) {
  const [company, setCompany] = useState('Correos');
  const [tracking, setTracking] = useState('');
  const [notify, setNotify] = useState(true);
  const fromShopify = order?.source === 'shopify';

  useEffect(() => {
    if (order) {
      setCompany('Correos');
      setTracking(order.tracking_number ?? '');
      setNotify(true);
    }
  }, [order]);

  const handleSubmit = async () => {
    if (!order) return;
    const ok = await onSubmit(order.id, {
      trackingCompany: company.trim() || undefined,
      trackingNumber: tracking.trim() || undefined,
      notifyCustomer: notify,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar pedido</DialogTitle>
          <DialogDescription>
            Pedido {order?.order_number} · {order?.customer_name}
            {fromShopify && '. Se marca como enviado también en Shopify.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ship-company">Transportista</Label>
            <Input id="ship-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-tracking">Número de seguimiento</Label>
            <Input
              id="ship-tracking"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="PQ…"
              autoFocus
            />
          </div>
          {fromShopify && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} />
              Avisar a la clienta por email con el seguimiento
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Truck className="w-4 h-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
