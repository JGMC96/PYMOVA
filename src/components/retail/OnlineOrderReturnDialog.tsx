import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { OnlineOrder } from '@/hooks/useOnlineOrders';

interface Props {
  order: OnlineOrder | null;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (
    orderId: string,
    payload: { kind: 'return' | 'exchange'; reason?: string; refund_method?: string; total: number; restock: boolean },
  ) => Promise<boolean>;
}

export function OnlineOrderReturnDialog({ order, onOpenChange, isSubmitting, onSubmit }: Props) {
  const [kind, setKind] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('original');
  const [amount, setAmount] = useState('0');
  const [restock, setRestock] = useState(true);

  useEffect(() => {
    if (order) {
      setKind('return');
      setReason('');
      setRefundMethod('original');
      setAmount(String(order.total));
      setRestock(true);
    }
  }, [order]);

  const handleSubmit = async () => {
    if (!order) return;
    const ok = await onSubmit(order.id, {
      kind,
      reason: reason.trim() || undefined,
      refund_method: refundMethod,
      total: Number(amount || 0),
      restock,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cambio o devolución</DialogTitle>
          <DialogDescription>
            Pedido {order?.order_number} · {order?.customer_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as 'return' | 'exchange')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="return">Devolución</SelectItem>
                <SelectItem value="exchange">Cambio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Importe a reembolsar (€)</Label>
            <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Método de reembolso</Label>
            <Select value={refundMethod} onValueChange={setRefundMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Método original</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
                <SelectItem value="store_credit">Vale de tienda</SelectItem>
                <SelectItem value="none">Sin reembolso</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="restock" checked={restock} onCheckedChange={(v) => setRestock(!!v)} />
            <Label htmlFor="restock" className="cursor-pointer font-normal">
              Devolver las unidades al inventario
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
