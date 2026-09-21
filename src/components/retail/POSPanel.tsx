import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  ScanLine, ArrowRightLeft, Layers, LayoutGrid, ChevronRight, ChevronDown,
  MoreVertical, X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const [showCatalog, setShowCatalog] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, string>>({});
  const [selectedPayment, setSelectedPayment] = useState<string>(profile.paymentMethods[0] ?? 'cash');
  const [tipInput, setTipInput] = useState('');
  const [cashInput, setCashInput] = useState('');
  const [notes, setNotes] = useState('');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
    const query = searchQuery.toLowerCase().trim();
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

  const searchResults = useMemo(
    () => (searchQuery.trim() ? filteredProducts.slice(0, 8) : []),
    [filteredProducts, searchQuery]
  );

  useEffect(() => {
    if (!profile.paymentMethods.includes(selectedPayment)) {
      setSelectedPayment(profile.paymentMethods[0] ?? 'cash');
    }
  }, [profile.paymentMethods, selectedPayment]);

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
    setSearchQuery('');
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
    setLineDiscounts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearCart = () => {
    setCart([]);
    setLineDiscounts({});
    setTipInput('');
    setCashInput('');
    setNotes('');
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const lineDiscountValue = (key: string, lineTotal: number) => {
    const raw = parseFloat(lineDiscounts[key] ?? '');
    if (isNaN(raw) || raw <= 0) return 0;
    return round2((lineTotal * Math.min(raw, 100)) / 100);
  };

  const grossSubtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const discountValue = round2(
    cart.reduce(
      (sum, item) => sum + lineDiscountValue(item.variant_id ?? item.product_id, item.total),
      0
    )
  );
  const subtotal = round2(grossSubtotal - discountValue);
  const tax = round2(subtotal * (taxRate / 100));
  const tip = profile.tipEnabled ? Math.max(round2(parseFloat(tipInput) || 0), 0) : 0;
  const total = round2(subtotal + tax);
  const dueTotal = round2(total + tip);
  const cashReceived = parseFloat(cashInput);
  const change =
    selectedPayment === 'cash' && !isNaN(cashReceived) ? round2(cashReceived - dueTotal) : null;
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const handleCheckout = async (method: string = selectedPayment) => {
    if (cart.length === 0) return;
    const usesCash = method === 'cash';
    if (usesCash && !isNaN(cashReceived) && cashReceived < dueTotal) {
      toast.error('El efectivo recibido es menor que el total');
      return;
    }
    setSelectedPayment(method);

    const snapshot = cart.map((item) => {
      const key = item.variant_id ?? item.product_id;
      const disc = lineDiscountValue(key, item.total);
      return { ...item, total: round2(item.total - disc) };
    });

    const result = await createSale({
      payment_method: method,
      items: snapshot,
      subtotal,
      tax,
      total,
      discount: discountValue,
      tip,
      cash_received: usesCash && !isNaN(cashReceived) ? cashReceived : null,
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
        paymentMethod: method,
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
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          No hay caja abierta. Las ventas se registrarán sin asociar al arqueo diario — ábrela en la pestaña <strong>Caja</strong>.
        </div>
      )}

      {/* Top search bar */}
      <div className="flex flex-col lg:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-11"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {searchResults.length > 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
              {searchResults.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/60 transition-colors duration-100 ease-smooth"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[product.sku, product.category].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="text-sm font-semibold shrink-0">{product.price.toFixed(2)} €</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleBarcodeSubmit} className="relative lg:w-72">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
          <Input
            ref={barcodeRef}
            placeholder="Escanear código"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className="pl-9 h-11"
            autoFocus
          />
        </form>

        <Button
          type="button"
          variant={showCatalog ? 'default' : 'outline'}
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => setShowCatalog((v) => !v)}
          aria-label="Ver catálogo"
        >
          <LayoutGrid className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 xl:h-[calc(100vh-300px)]">
        {/* Ticket lines */}
        <Card className="flex flex-col overflow-hidden min-h-[420px]">
          <div className="grid grid-cols-[72px_1fr_110px_100px_40px] items-center gap-2 px-4 py-3 border-b text-xs font-medium text-muted-foreground">
            <span>Uds.</span>
            <span>Producto</span>
            <span className="text-right">Descuento</span>
            <span className="text-right">Precio</span>
            <span />
          </div>

          <ScrollArea className="flex-1">
            {cart.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                Busca o escanea un producto para empezar la venta
              </p>
            ) : (
              <div className="divide-y">
                {cart.map((item) => {
                  const key = item.variant_id ?? item.product_id;
                  const disc = lineDiscountValue(key, item.total);
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-[72px_1fr_110px_100px_40px] items-center gap-2 px-4 py-3"
                    >
                      <div className="flex items-center rounded-md border overflow-hidden">
                        <button
                          onClick={() => updateQuantity(key, -1)}
                          className="px-1.5 py-1.5 hover:bg-accent transition-colors duration-100 ease-smooth"
                          aria-label="Restar unidad"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="flex-1 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(key, 1)}
                          className="px-1.5 py-1.5 hover:bg-accent transition-colors duration-100 ease-smooth"
                          aria-label="Sumar unidad"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.unit_price.toFixed(2)} € c/u
                        </p>
                      </div>

                      <div className="flex items-center gap-1 justify-end">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0"
                          value={lineDiscounts[key] ?? ''}
                          onChange={(e) =>
                            setLineDiscounts((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="h-8 w-16 text-right"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>

                      <p className="text-sm font-semibold text-right">
                        {(item.total - disc).toFixed(2)} €
                      </p>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => removeFromCart(key)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Quitar de la venta
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            )}

            {showCatalog && (
              <div className="border-t p-4 space-y-3">
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

                {productsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredProducts.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-[background-color,transform] duration-100 ease-smooth active:scale-[0.98] text-left"
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
              </div>
            )}
          </ScrollArea>

          <div className="border-t p-3">
            <Input
              placeholder="Notas o comentarios"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 px-1"
            />
          </div>
        </Card>

        {/* Receipt summary */}
        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold">Recibo</h3>
              {cart.length > 0 && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors duration-100 ease-smooth"
                  onClick={clearCart}
                >
                  Vaciar
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
            </p>

            <Separator className="my-3" />

            <button
              className="w-full flex items-center justify-between text-sm"
              onClick={() => setBreakdownOpen((v) => !v)}
            >
              <span className="flex items-center gap-1 text-muted-foreground">
                {breakdownOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                Subtotal
              </span>
              <span>{subtotal.toFixed(2)} €</span>
            </button>

            {breakdownOpen && (
              <div className="mt-2 space-y-1.5 text-sm pl-5">
                <div className="flex justify-between text-muted-foreground">
                  <span>Bruto</span>
                  <span>{grossSubtotal.toFixed(2)} €</span>
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Descuentos</span>
                    <span>-{discountValue.toFixed(2)} €</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>IVA ({taxRate}%)</span>
                  <span>{tax.toFixed(2)} €</span>
                </div>
                {tip > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Propina</span>
                    <span>{tip.toFixed(2)} €</span>
                  </div>
                )}
              </div>
            )}

            <Separator className="my-3" />

            <div className="flex justify-between text-xl font-bold">
              <span>Total</span>
              <span>{dueTotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground mt-1">
              <span>Cambio</span>
              <span>{change !== null && change > 0 ? change.toFixed(2) : '0.00'} €</span>
            </div>

            {(selectedPayment === 'cash' || profile.tipEnabled) && (
              <div className="grid grid-cols-2 gap-2 mt-3">
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
            )}

            {change !== null && change < 0 && (
              <p className="mt-2 text-xs text-destructive">
                Faltan {Math.abs(change).toFixed(2)} € para cubrir el total.
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Payment bar */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Button
          size="lg"
          className="h-14 text-base"
          disabled={cart.length === 0 || isCreating}
          onClick={() => handleCheckout()}
        >
          {isCreating ? 'Procesando...' : `Pagar ${dueTotal.toFixed(2)} €`}
        </Button>

        {profile.paymentMethods
          .filter((m) => m !== selectedPayment)
          .slice(0, 2)
          .map((method) => {
            const Icon = PAYMENT_ICONS[method] ?? Banknote;
            return (
              <Button
                key={method}
                size="lg"
                variant="secondary"
                className="h-14 text-base"
                disabled={cart.length === 0 || isCreating}
                onClick={() => handleCheckout(method)}
              >
                <Icon className="w-5 h-5 mr-2" />
                Pagar con {(PAYMENT_LABELS[method] ?? method).toLowerCase()}
              </Button>
            );
          })}
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
                className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-[background-color,transform] duration-100 ease-smooth active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-left"
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
