import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Plus, Minus, Trash2, CreditCard, Banknote,
  ScanLine, ArrowRightLeft, Layers, LayoutGrid, ChevronRight, ChevronDown,
  MoreVertical, X, PenLine, Ticket,
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
import { SellerBar } from './SellerBar';
import { PosClientPicker } from './PosClientPicker';
import { canEmailReceipt, type PosClient } from '@/hooks/usePosClients';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { discountPct, isSellerSessionError } from '@/lib/sellerSession';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DEFAULT_TAX_RATE, taxBreakdown } from '@/lib/tax';
import { cashChange, parseCash, quickCashAmounts } from '@/lib/cobro';
import { CashRegisterStaleBanner } from './CashRegisterStaleBanner';
import { VariosDialog } from './VariosDialog';
import { VoucherDialog, type AppliedVoucher } from './VoucherDialog';
import { voucherApplied } from '@/lib/vales';
import { matchesVarios } from '@/lib/varios';
import { findByCode, POS_SEARCH_LIMIT, searchPosProducts, type PosSearchHit } from '@/lib/posSearch';

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowRightLeft,
};

export function POSPanel({ onGoToRegister }: { onGoToRegister?: () => void } = {}) {
  // También los inactivos en Shopify que aún tienen stock en la tienda (0053), marcados y detrás.
  const { products, isLoading: productsLoading, refreshProducts } = useInventory({ inactiveWithStock: true });
  const { createSale, isCreating } = useRetailSales();
  const { settings } = useBusinessSettings();
  const { profile } = useStoreProfile();
  const { openSession, refresh: refreshRegister } = useCashRegister();
  const sellerSession = useSellerSession();

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
  const [client, setClient] = useState<PosClient | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [variantProduct, setVariantProduct] = useState<ProductWithStock | null>(null);
  const [variosOpen, setVariosOpen] = useState(false);
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const taxRate = settings?.tax_rate ?? DEFAULT_TAX_RATE;
  // Método con el que empieza cada venta (el primero del perfil: efectivo).
  const defaultPayment = profile.paymentMethods[0] ?? 'cash';

  const categories = useMemo(() => {
    const fromProducts = products.map((p) => p.category).filter(Boolean) as string[];
    return Array.from(new Set([...fromProducts, ...profile.categories]));
  }, [products, profile.categories]);

  // Sin tildes ni mayúsculas, palabra a palabra y también por talla, SKU o código de la talla.
  const searchHits = useMemo(
    () => searchPosProducts(products.filter((p) => !categoryFilter || p.category === categoryFilter), searchQuery),
    [products, searchQuery, categoryFilter]
  );
  const filteredProducts = useMemo(() => searchHits.map((h) => h.product), [searchHits]);

  // Con el catálogo abierto, la búsqueda filtra el catálogo y no sale el desplegable.
  const searchResults = useMemo(
    () => (searchQuery.trim() && !showCatalog ? searchHits.slice(0, POS_SEARCH_LIMIT) : []),
    [searchHits, searchQuery, showCatalog]
  );
  // «Varios» no es un producto del catálogo: al buscarlo, sale como primera opción.
  const showVariosResult = matchesVarios(searchQuery);

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

  // Si la búsqueda señala una talla con stock, va directa al ticket; si no, se elige.
  const handleSearchHitClick = (hit: PosSearchHit<ProductWithStock>) => {
    if (hit.variant && hit.variant.stock_quantity > 0) {
      setSearchQuery('');
      pushToCart(hit.product, hit.variant);
      return;
    }
    handleProductClick(hit.product);
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;

    const hit = findByCode(products, code);
    if (hit) {
      pushToCart(hit.product, hit.variant);
    } else {
      toast.error(`Sin coincidencias para "${code}"`);
    }
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
    setClient(null);
    setVoucher(null);
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
  // Los precios del catálogo incluyen el IVA: el total es lo que paga el cliente y
  // la base imponible y la cuota se deducen de él (como en el ticket y en la RPC).
  const total = round2(grossSubtotal - discountValue);
  const { base: subtotal, tax } = taxBreakdown(total, taxRate);
  const tip = profile.tipEnabled ? Math.max(round2(parseFloat(tipInput) || 0), 0) : 0;
  // Vale de tienda: paga como mucho su saldo y el total (si el ticket baja, baja con él).
  const voucherAmount = voucher ? voucherApplied(voucher.amount, voucher.balance, total) : 0;
  const dueTotal = round2(total + tip - voucherAmount);
  const paidByVoucher = voucherAmount > 0 && dueTotal === 0;
  const paymentMethod = paidByVoucher ? 'store_credit' : selectedPayment;
  const isCash = paymentMethod === 'cash';
  // Sin importe entregado se entiende que paga el importe exacto.
  const cashReceived = isCash ? parseCash(cashInput) : null;
  const change = isCash ? cashChange(cashInput, dueTotal) : null;
  const cashShortfall = change !== null && change < 0;
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const PayIcon = paidByVoucher ? Ticket : PAYMENT_ICONS[selectedPayment] ?? Banknote;

  const handleCheckout = async () => {
    if (cart.length === 0 || isCreating) return;
    const method = paymentMethod;
    const usesCash = method === 'cash';
    if (usesCash && !openSession) {
      toast.error('Abre la caja para cobrar en efectivo');
      return;
    }
    if (usesCash && cashShortfall) {
      toast.error('El efectivo entregado es menor que el total');
      return;
    }
    // Con dependientes con PIN, la venta va a nombre de quien la hace: si hay una persona
    // conectada se usa esa, si hay varias se pregunta y si no hay nadie se pide el PIN.
    const pick = await sellerSession.chooseSeller('la venta');
    if (pick.cancelled) return;
    const seller = pick.seller;
    // Descuento por encima del máximo de quien vende: lo autoriza un encargado con su PIN.
    const pct = discountPct(discountValue, total);
    let authorizationId: string | null = null;
    if (pct > 0 && !sellerSession.can(seller, 'discount', pct)) {
      authorizationId = await sellerSession.authorize('discount', 'la venta', pct);
      if (!authorizationId) return;
    }
    const snapshot = cart.map((item) => {
      const key = item.variant_id ?? item.product_id;
      const disc = lineDiscountValue(key, item.total);
      return { ...item, total: round2(item.total - disc) };
    });

    let failure = '';
    const result = await createSale({
      payment_method: method,
      client_id: client?.id ?? null,
      items: snapshot,
      notes: notes.trim() || undefined,
      subtotal,
      tax,
      total,
      discount: discountValue,
      tip,
      cash_received: usesCash ? cashReceived : null,
      change_given: change !== null && change >= 0 ? change : null,
      register_session_id: openSession?.id ?? null,
      seller_session_id: seller?.sessionId ?? null,
      authorization_id: authorizationId,
      voucher_code: voucherAmount > 0 ? voucher?.code ?? null : null,
      voucher_amount: voucherAmount > 0 ? voucherAmount : null,
    }, { onError: (m) => { failure = m; } });

    if (!result && seller && isSellerSessionError(failure)) {
      // La sesión ya no vale (caducada o cerrada en otro sitio): fuera de la lista;
      // al volver a cobrar se preguntará de nuevo.
      sellerSession.dropSession(seller.sessionId);
    }

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
        originalTotals: Object.fromEntries(cart.map((i) => [i.variant_id ?? i.product_id, i.total])),
        tip,
        cashReceived: usesCash ? cashReceived : null,
        change: change !== null && change >= 0 ? change : null,
        notes: notes.trim() || null,
        cashier: seller?.name ?? null,
        saleId: result.id,
        clientName: client?.name ?? null,
        clientCanEmail: canEmailReceipt(client),
        voucherPaid: voucher && voucherAmount > 0
          ? { code: voucher.code, amount: voucherAmount, balanceLeft: round2(voucher.balance - voucherAmount) }
          : null,
      });
      setTicketOpen(true);
      if (change !== null && change > 0) {
        toast.success(`Cambio a devolver: ${change.toFixed(2)} €`);
      }
      clearCart();
      setSelectedPayment(defaultPayment);
      refreshProducts();
      refreshRegister();
      barcodeRef.current?.focus();
    }
  };

  return (
    <>
      <SellerBar />
      {!openSession ? (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          No hay caja abierta. Para cobrar en efectivo, ábrela en <strong>Ventas › Caja</strong>. Con tarjeta o transferencia puedes vender igualmente.
        </div>
      ) : (
        <CashRegisterStaleBanner openedAt={openSession.opened_at} onGoToRegister={onGoToRegister} />
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

          {(searchResults.length > 0 || showVariosResult) && (
            <div className="absolute z-30 mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg border bg-popover shadow-lg">
              {showVariosResult && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setVariosOpen(true);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/60 transition-colors duration-100 ease-smooth"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      <PenLine className="w-3.5 h-3.5" />
                      Varios
                    </p>
                    <p className="text-xs text-muted-foreground truncate">Línea libre: escribe la descripción y el precio</p>
                  </div>
                </button>
              )}
              {searchResults.map((hit) => {
                const { product, variant } = hit;
                return (
                  <button
                    key={variant?.id ?? product.id}
                    onClick={() => handleSearchHitClick(hit)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/60 transition-colors duration-100 ease-smooth"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {variant ? `${product.name} · ${variant.name}` : product.name}
                        {!product.is_active && <InactiveBadge className="ml-2" />}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[variant ? variant.sku ?? variant.barcode : product.sku, product.category]
                          .filter(Boolean)
                          .join(' · ')}
                        {variant && ` · Stock: ${variant.stock_quantity}`}
                      </p>
                    </div>
                    <span className="text-sm font-semibold shrink-0">
                      {(variant?.price ?? product.price).toFixed(2)} €
                    </span>
                  </button>
                );
              })}
              {searchHits.length > searchResults.length && (
                <button
                  onClick={() => setShowCatalog(true)}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-primary border-t hover:bg-accent/60 transition-colors duration-100 ease-smooth"
                >
                  Ver los {searchHits.length} resultados en el catálogo
                </button>
              )}
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
          variant="outline"
          className="h-11 shrink-0 gap-2"
          onClick={() => setVariosOpen(true)}
        >
          <PenLine className="w-4 h-4" />
          Varios
        </Button>

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
                          {!product.is_active && <InactiveBadge />}
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

            <PosClientPicker value={client} onChange={setClient} className="mt-3" />

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
                Subtotal (IVA incl.)
              </span>
              <span>{total.toFixed(2)} €</span>
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
                  <span>Base imponible</span>
                  <span>{subtotal.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>IVA ({taxRate}%) incluido</span>
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

            {voucher && voucherAmount > 0 ? (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <Ticket className="w-4 h-4" />
                  Vale {voucher.code}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">-{voucherAmount.toFixed(2)} €</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Quitar el vale"
                    onClick={() => setVoucher(null)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-2 w-full"
                disabled={total <= 0}
                onClick={() => setVoucherOpen(true)}
              >
                <Ticket className="w-4 h-4 mr-1.5" />
                Pagar con vale
              </Button>
            )}

            <div className="flex justify-between text-xl font-bold">
              <span>{voucherAmount > 0 ? 'Resto a pagar' : 'Total'}</span>
              <span>{dueTotal.toFixed(2)} €</span>
            </div>
            {/* Método de pago: se elige antes de cobrar (no hace falta si el vale lo paga todo). */}
            {!paidByVoucher && (
            <div
              className="mt-3 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${profile.paymentMethods.length || 1}, minmax(0, 1fr))` }}
              role="radiogroup"
              aria-label="Método de pago"
            >
              {profile.paymentMethods.map((method) => {
                const Icon = PAYMENT_ICONS[method] ?? Banknote;
                const active = method === selectedPayment;
                const blocked = method === 'cash' && !openSession;
                return (
                  <Button
                    key={method}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    variant={active ? 'default' : 'outline'}
                    className="h-11"
                    disabled={blocked}
                    title={blocked ? 'Abre la caja para cobrar en efectivo' : undefined}
                    onClick={() => setSelectedPayment(method)}
                  >
                    <Icon className="w-4 h-4 mr-1.5" />
                    {PAYMENT_LABELS[method] ?? method}
                  </Button>
                );
              })}
            </div>
            )}

            {isCash && (
              <div className="mt-3 space-y-2">
                <Label htmlFor="pos-cash" className="text-xs text-muted-foreground">Entregado</Label>
                <Input
                  id="pos-cash"
                  inputMode="decimal"
                  placeholder={`${dueTotal.toFixed(2)} (exacto)`}
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCheckout();
                    }
                  }}
                  className="h-11 text-lg"
                />
                {dueTotal > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {quickCashAmounts(dueTotal).map((amount, i) => (
                      <Button
                        key={amount}
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setCashInput(amount.toFixed(2))}
                      >
                        {i === 0 ? 'Exacto' : `${amount} €`}
                      </Button>
                    ))}
                  </div>
                )}
                <div
                  className={cn(
                    'flex items-baseline justify-between rounded-lg px-3 py-2',
                    cashShortfall ? 'bg-destructive/10 text-destructive' : 'bg-primary/10',
                  )}
                  aria-live="polite"
                >
                  <span className="text-sm font-medium">{cashShortfall ? 'Faltan' : 'Cambio'}</span>
                  <span className="text-2xl font-bold">
                    {change === null ? '0.00' : Math.abs(change).toFixed(2)} €
                  </span>
                </div>
              </div>
            )}

            {profile.tipEnabled && (
              <div className="mt-3">
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
          </Card>
        </div>
      </div>

      {/* Cobro: un solo botón con el método elegido. */}
      <div className="mt-4">
        <Button
          size="lg"
          className="h-14 w-full text-base"
          disabled={cart.length === 0 || isCreating || (isCash && (!openSession || cashShortfall))}
          onClick={() => void handleCheckout()}
        >
          <PayIcon className="w-5 h-5 mr-2" />
          {isCreating
            ? 'Procesando...'
            : paidByVoucher
              ? `Cobrar con vale · ${voucherAmount.toFixed(2)} €`
              : `Cobrar ${dueTotal.toFixed(2)} € · ${PAYMENT_LABELS[selectedPayment] ?? selectedPayment}`}
        </Button>
      </div>

      <VoucherDialog
        open={voucherOpen}
        onOpenChange={(o) => {
          setVoucherOpen(o);
          if (!o) barcodeRef.current?.focus();
        }}
        total={total}
        onApply={setVoucher}
      />

      {/* Variant picker */}
      <VariosDialog
        open={variosOpen}
        onOpenChange={(o) => {
          setVariosOpen(o);
          if (!o) barcodeRef.current?.focus();
        }}
        onAdd={(item) => setCart((prev) => [...prev, item])}
      />

      <Dialog open={!!variantProduct} onOpenChange={(o) => !o && setVariantProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Elige una opción · {variantProduct?.name}</DialogTitle>
            {variantProduct && !variantProduct.is_active && (
              <p className="text-sm text-muted-foreground">
                <InactiveBadge className="mr-1.5" />
                No está activo en Shopify: se vende en tienda, pero no sale en la web.
              </p>
            )}
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

/** Producto inactivo en Shopify (borrador o archivado) que aún tiene stock en la tienda. */
function InactiveBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn('text-xs font-normal text-muted-foreground', className)}>
      Inactivo en Shopify
    </Badge>
  );
}
