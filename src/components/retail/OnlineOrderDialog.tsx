import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import type { NewOnlineOrder, NewOnlineOrderItem } from '@/hooks/useOnlineOrders';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewOnlineOrder) => Promise<boolean>;
  isSubmitting: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
}

export function OnlineOrderDialog({ open, onOpenChange, onSubmit, isSubmitting }: Props) {
  const { activeBusinessId } = useBusiness();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<NewOnlineOrderItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [shipping, setShipping] = useState('0');
  const [tax, setTax] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [source, setSource] = useState('web');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open || !activeBusinessId) return;
    supabase
      .from('products')
      .select('id, name, price')
      .eq('business_id', activeBusinessId)
      .eq('is_active', true)
      .order('name')
      .limit(300)
      .then(({ data }) => setProducts((data ?? []) as ProductOption[]));
  }, [open, activeBusinessId]);

  useEffect(() => {
    if (!open) {
      setItems([]); setCustomerName(''); setEmail(''); setPhone(''); setAddress('');
      setShipping('0'); setTax('0'); setDiscount('0'); setPaymentStatus('pending');
      setSource('web'); setNotes('');
    }
  }, [open]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.total, 0), [items]);
  const total = subtotal + Number(shipping || 0) + Number(tax || 0) - Number(discount || 0);

  const addProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        variant_id: null,
        product_name: product.name,
        quantity: 1,
        unit_price: Number(product.price),
        total: Number(product.price),
      },
    ]);
  };

  const updateQuantity = (index: number, quantity: number) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, quantity, total: quantity * item.unit_price } : item,
      ),
    );
  };

  const canSubmit = customerName.trim().length > 0 && items.length > 0;

  const handleSubmit = async () => {
    const ok = await onSubmit({
      customer_name: customerName.trim(),
      customer_email: email.trim() || undefined,
      customer_phone: phone.trim() || undefined,
      shipping_address: address.trim() || undefined,
      shipping_cost: Number(shipping || 0),
      tax: Number(tax || 0),
      discount: Number(discount || 0),
      payment_status: paymentStatus,
      source,
      notes: notes.trim() || undefined,
      items,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo pedido online</DialogTitle>
          <DialogDescription>
            Registra un pedido recibido por tu tienda online, redes o teléfono.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer">Cliente *</Label>
              <Input id="customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Teléfono</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source">Origen</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">Web propia</SelectItem>
                  <SelectItem value="shopify">Shopify</SelectItem>
                  <SelectItem value="marketplace">Marketplace</SelectItem>
                  <SelectItem value="social">Redes sociales</SelectItem>
                  <SelectItem value="manual">Manual / teléfono</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address">Dirección de envío</Label>
            <Textarea id="address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Productos</Label>
            <Select value="" onValueChange={addProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Añadir producto…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {Number(p.price).toFixed(2)} €
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Añade al menos un producto al pedido.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={`${item.product_id}-${index}`} className="flex items-center gap-2 rounded-lg border p-2">
                    <span className="flex-1 truncate text-sm">{item.product_name}</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      value={item.quantity}
                      onChange={(e) => updateQuantity(index, Number(e.target.value) || 1)}
                    />
                    <span className="w-24 text-right text-sm font-medium">
                      {item.total.toFixed(2)} €
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="shipping">Envío (€)</Label>
              <Input id="shipping" type="number" value={shipping} onChange={(e) => setShipping(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax">Impuestos (€)</Label>
              <Input id="tax" type="number" value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount">Descuento (€)</Label>
              <Input id="discount" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paystatus">Pago</Label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger id="paystatus"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="paid">Pagado</SelectItem>
                  <SelectItem value="refunded">Reembolsado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Subtotal {subtotal.toFixed(2)} €</span>
            <span className="font-semibold">Total {total.toFixed(2)} €</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Crear pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
