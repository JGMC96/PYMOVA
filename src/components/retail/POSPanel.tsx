import { useState, useMemo, useRef } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote,
  ScanLine, Percent, ArrowRightLeft, Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInventory, ProductWithStock } from '@/hooks/useInventory';
import { useRetailSales, CartItem } from '@/hooks/useRetailSales';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import { useStoreProfile } from '@/hooks/useStoreProfile';
import { useCashRegister } from '@/hooks/useCashRegister';
import type { ProductVariant } from '@/hooks/useProductVariants';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';
import { SaleTicketDialog, TicketData } from './SaleTicketDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowRightLeft,
};

export function POSPanel() {
  const { products, isLoading: productsLoading, refreshProducts } = useInventory();
  const { createSale, isCreating } = useRetailSales();
  const { settings } = useBusinessSettings();
  const { profile } = useStoreProfile();
  const { openSession, refresh: refreshRegister } = useCashRegister();

  const [searchQuery, setSearchQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<string>(profile.paymentMethods[0] ?? 'cash');
  const [discountInput, setDiscountInput] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [tipInput, setTipInput] = useState('');
  const [cashInput, setCashInput] = useState('');
  const [variantProduct, setVariantProduct] = useState<ProductWithStock | null>(null);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const taxRate = settings?.tax_rate ?? 16;

  const categories = useMemo(() => {
    const fromProducts = products.map((p) => p.category).filter(Boolean) as string[];
    return Array.from(new Set([...fromProducts, ...profile.categories]));
  }, [products, profile.categories]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return products.filter((p) => {
      const matchesCategory = !categoryFilter || p.category === categoryFilter;
      const matchesQuery =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query) ||
        p.sku?.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [products, searchQuery, categoryFilter]);

  const pushToCart = (
    product: ProductWithStock,
    variant?: ProductVariant | null,
    qty = 1
  ) => {
    const unitPrice = variant?.price ?? product.price;
    const name = variant ? `${product.name} · ${variant.name}` : product.name;
    const key = variant?.id ?? product.id;

    setCart((prev) => {
      const existing = prev.find((item) => (item.variant_id ?? item.product_id) === key);
      if (existing) {
        return prev.map((item) =>
          (item.variant_id ?? item.product_id) === key
            ? { ...item, quantity: item.quantity + qty, total: (item.quantity + qty) * item.unit_price }
            : item
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          variant_id: variant?.id ?? null,
          product_name: name,
          quantity: qty,
          unit_price: unitPrice,
          total: unitPrice * qty,
        },
      ];
    });
  };

  const handleProductClick = (product: ProductWithStock) => {
    if (product.variants.length > 0) {
      setVariantProduct(product);
      return;
    }
    pushToCart(product);
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;

    for (const product of products) {
      const variant = product.variants.find((v) => v.barcode === code || v.sku === code);
      if (variant) {
        pushToCart(product, variant);
        setBarcode('');
        return;
      }
      if (product.barcode === code || product.sku === code) {
        pushToCart(product);
        setBarcode('');
        return;
      }
    }
    toast.error(`Sin coincidencias para "${code}"`);
    setBarcode('');
  };

  const updateQuantity = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if ((item.variant_id ?? item.product_id) === key) {
            const newQty = item.quantity + delta;
            if (newQty <= 0) return null;
            return { ...item, quantity: newQty, total: newQty * item.unit_price };
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((item) => (item.variant_id ?? item.product_id) !== key));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountInput('');
    setTipInput('');
    setCashInput('');
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const grossSubtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const discountValue = (() => {
    const raw = parseFloat(discountInput);
    if (isNaN(raw) || raw <= 0) return 0;
    const value = discountMode === 'percent' ? (grossSubtotal * raw) / 100 : raw;
    return round2(Math.min(value, grossSubtotal));
  })();
  const subtotal = round2(grossSubtotal - discountValue);
  const tax = round2(subtotal * (taxRate / 100));
  const tip = profile.tipEnabled ? Math.max(round2(parseFloat(tipInput) || 0), 0) : 0;
  const total = round2(subtotal + tax);
  const dueTotal = round2(total + tip);
  const cashReceived = parseFloat(cashInput);
  const change =
    selectedPayment === 'cash' && !isNaN(cashReceived) ? round2(cashReceived - dueTotal) : null;

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (selectedPayment === 'cash' && !isNaN(cashReceived) && cashReceived < dueTotal) {
      toast.error('El efectivo recibido es menor que el total');
      return;
    }

    const snapshot = [...cart];

    const result = await createSale({
      payment_method: selectedPayment,
      items: snapshot,
      subtotal,
      tax,
      total,
      discount: discountValue,
      tip,
      cash_received: selectedPayment === 'cash' && !isNaN(cashReceived) ? cashReceived : null,
      change_given: change !== null && change >= 0 ? change : null,
      register_session_id: openSession?.id ?? null,
    });

    if (result) {
      setTicket({
        saleNumber: result.sale_number,
        items: snapshot,
        subtotal,
        tax,
        taxRate,
        total: dueTotal,
        paymentMethod: selectedPayment,
        createdAt: new Date(),
      });
      setTicketOpen(true);
      if (change !== null && change > 0) {
        toast.success(`Cambio a devolver: ${change.toFixed(2)} €`);
      }
      clearCart();
      refreshProducts();
      refreshRegister();
      barcodeRef.current?.focus();
    }
  };

  return (
    <>
      {!openSession && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          No hay caja abierta. Las ventas se registrarán sin asociar al arqueo diario — ábrela en la pestaña <strong>Caja</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-260px)]">
        {/* Products Panel */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {profile.emoji} {profile.label}
              </CardTitle>
            </div>

            <form onSubmit={handleBarcodeSubmit} className="relative">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
              <Input
                ref={barcodeRef}
                placeholder="Escanear código de barras y pulsar Enter"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </form>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar producto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={categoryFilter === null ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setCategoryFilter(null)}
                >
                  Todas
                </Badge>
                {categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant={categoryFilter === cat ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full px-6">
              {productsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
                </div>
              ) : filteredProducts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No se encontraron productos
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pb-4">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handleProductClick(product)}
                      className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left"
                    >
                      <p className="font-medium text-sm truncate">{product.name}</p>
                      <p className="text-primary font-semibold">
                        {product.price.toFixed(2)} €
                        {product.unit && (
                          <span className="text-xs text-muted-foreground"> / {product.unit}</span>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {product.variants.length > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Layers className="w-3 h-3" />
                            {product.variants.length}
                          </Badge>
                        )}
                        {product.track_inventory && product.variants.length === 0 && (
                          <Badge
                            variant={product.stock_quantity > 0 ? 'secondary' : 'destructive'}
                            className="text-xs"
                          >
                            Stock: {product.stock_quantity}
                          </Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Cart Panel */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Carrito
              {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            <ScrollArea className="flex-1 px-6">
              {cart.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Carrito vacío</p>
              ) : (
                <div className="space-y-3 pb-4">
                  {cart.map((item) => {
                    const key = item.variant_id ?? item.product_id;
                    return (
                      <div key={key} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.product_name}</p>
                          <p className="text-muted-foreground text-xs">
                            {item.unit_price.toFixed(2)} € c/u
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(key, -1)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-8 text-center font-medium">{item.quantity}</span>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(key, 1)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="font-semibold w-20 text-right">{item.total.toFixed(2)} €</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeFromCart(key)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Totals & Checkout */}
            <div className="p-6 pt-0 space-y-4">
              <Separator />

              {/* Discount */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Descuento</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="flex">
                  <Button
                    type="button"
                    variant={discountMode === 'amount' ? 'default' : 'outline'}
                    className="h-9 rounded-r-none"
                    onClick={() => setDiscountMode('amount')}
                  >
                    €
                  </Button>
                  <Button
                    type="button"
                    variant={discountMode === 'percent' ? 'default' : 'outline'}
                    className="h-9 rounded-l-none"
                    onClick={() => setDiscountMode('percent')}
                  >
                    <Percent className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {discountValue > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Bruto</span>
                    <span>{grossSubtotal.toFixed(2)} €</span>
                  </div>
                )}
                {discountValue > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Descuento</span>
                    <span>-{discountValue.toFixed(2)} €</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{subtotal.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IVA ({taxRate}%)</span>
                  <span>{tax.toFixed(2)} €</span>
                </div>
                {tip > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Propina</span>
                    <span>{tip.toFixed(2)} €</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span className="text-primary">{dueTotal.toFixed(2)} €</span>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="flex gap-2">
                {profile.paymentMethods.map((method) => {
                  const Icon = PAYMENT_ICONS[method] ?? Banknote;
                  return (
                    <Button
                      key={method}
                      variant={selectedPayment === method ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => setSelectedPayment(method)}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {PAYMENT_LABELS[method] ?? method}
                    </Button>
                  );
                })}
              </div>

              <div className={cn('grid gap-2', profile.tipEnabled ? 'grid-cols-2' : 'grid-cols-1')}>
                {selectedPayment === 'cash' && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Efectivo recibido</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={cashInput}
                      onChange={(e) => setCashInput(e.target.value)}
                      className="h-9"
                    />
                  </div>
                )}
                {profile.tipEnabled && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Propina</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={tipInput}
                      onChange={(e) => setTipInput(e.target.value)}
                      className="h-9"
                    />
                  </div>
                )}
              </div>

              {change !== null && (
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium flex justify-between',
                    change >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                  )}
                >
                  <span>Cambio</span>
                  <span>{change.toFixed(2)} €</span>
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={cart.length === 0 || isCreating}
                onClick={handleCheckout}
              >
                {isCreating ? 'Procesando...' : `Cobrar ${dueTotal.toFixed(2)} €`}
              </Button>

              {cart.length > 0 && (
                <Button variant="ghost" className="w-full text-destructive" onClick={clearCart}>
                  Vaciar carrito
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Variant picker */}
      <Dialog open={!!variantProduct} onOpenChange={(o) => !o && setVariantProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Elige una opción · {variantProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
            {variantProduct?.variants.map((variant) => (
              <button
                key={variant.id}
                disabled={variant.stock_quantity <= 0}
                onClick={() => {
                  pushToCart(variantProduct, variant);
                  setVariantProduct(null);
                }}
                className="p-3 rounded-lg border bg-card hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed text-left"
              >
                <p className="font-medium text-sm">{variant.name}</p>
                <p className="text-primary font-semibold text-sm">
                  {(variant.price ?? variantProduct.price).toFixed(2)} €
                </p>
                <Badge
                  variant={variant.stock_quantity > 0 ? 'secondary' : 'destructive'}
                  className="mt-1 text-xs"
                >
                  Stock: {variant.stock_quantity}
                </Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <SaleTicketDialog open={ticketOpen} onOpenChange={setTicketOpen} ticket={ticket} />
    </>
  );
}
