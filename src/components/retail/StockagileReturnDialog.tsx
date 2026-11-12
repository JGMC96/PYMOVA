import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { useCashRegister } from '@/hooks/useCashRegister';
import { useStockagileReturn } from '@/hooks/useStockagileReturn';
import {
  lineRefund, resolvedVariant, returnItems, suggestedRefundMethod,
  type PickedVariant, type ReturnableLine, type ReturnableTicket,
} from '@/lib/stockagileReturn';
import { useStoreProfile } from '@/hooks/useStoreProfile';
import { REFUND_LABELS, refundMethods } from '@/lib/storeProfiles';
import { round2 } from '@/lib/tax';

const eur = (n: number) => `${n.toFixed(2)} €`;

/** Escanear el par o buscarlo en el catálogo. */
function VariantPicker({
  label, search, onPick,
}: {
  label: string;
  search: (raw: string) => Promise<PickedVariant[]>;
  onPick: (variant: PickedVariant) => void;
}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<PickedVariant[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const lastSearch = useRef(0);

  const run = async () => {
    const id = ++lastSearch.current;
    setIsSearching(true);
    const found = await search(text);
    if (id !== lastSearch.current) return;
    setIsSearching(false);
    // Un código escaneado que da una sola talla se elige solo.
    if (found.length === 1 && /^\d{8,14}$/.test(text.trim())) {
      onPick(found[0]);
      return;
    }
    setResults(found);
  };

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={label}
          className="h-8 pl-7 text-sm"
          placeholder="Escanea el par o escribe nombre y talla, e Intro"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResults(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void run();
          }}
        />
        {isSearching && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin" />}
      </div>
      {results && results.length === 0 && <p className="text-xs text-muted-foreground">No se encuentra esa talla.</p>}
      {results && results.length > 0 && (
        <ul className="rounded-md border text-sm">
          {results.map((v) => (
            <li key={v.id}>
              <button type="button" className="w-full px-2 py-1 text-left hover:bg-muted" onClick={() => onPick(v)}>
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface StockagileReturnDialogProps {
  saleId: string | null;
  onClose: () => void;
  /** Devolución registrada: el padre abre su ticket de abono. */
  onReturned: (returnId: string) => void;
}

/** Devolver o cambiar un ticket de Stockagile: una devolución normal de PYMOVA (0060). */
export function StockagileReturnDialog({ saleId, onClose, onReturned }: StockagileReturnDialogProps) {
  const { fetchReturnable, searchVariants, createReturn, isLoading, isSubmitting } = useStockagileReturn();
  const { chooseSeller, dropSession, can, authorize } = useSellerSession();
  const { openSession } = useCashRegister();
  const [ticket, setTicket] = useState<ReturnableTicket | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [picks, setPicks] = useState<Record<string, PickedVariant>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const { profile } = useStoreProfile();
  const [refundMethod, setRefundMethod] = useState('store_credit');
  const [restock, setRestock] = useState(true);

  useEffect(() => {
    setTicket(null);
    setQuantities({});
    setPicks({});
    setConfirmed({});
    setReason('');
    setRestock(true);
    if (!saleId) return;
    let cancelled = false;
    void fetchReturnable(saleId).then((t) => {
      if (cancelled) return;
      setTicket(t);
      setRefundMethod(suggestedRefundMethod(t?.payment_methods ?? null) ?? 'store_credit');
    });
    return () => {
      cancelled = true;
    };
  }, [saleId, fetchReturnable]);

  const lines = ticket?.lines ?? [];
  const totalRefund = round2(lines.reduce((sum, l) => sum + lineRefund(l, quantities[l.line_key] ?? 0), 0));
  const hasUnits = lines.some((l) => (quantities[l.line_key] ?? 0) > 0);
  const cashWithoutRegister = refundMethod === 'cash' && !openSession;
  const blocked = ticket?.blocked ?? null;
  // Una talla propuesta por el nombre hay que confirmarla, o elegir otra, antes de devolver.
  const pendingConfirmation = restock && lines.some(
    (l) => (quantities[l.line_key] ?? 0) > 0 && l.variant_match === 'name' && !picks[l.line_key] && !confirmed[l.line_key],
  );

  const handleSubmit = async () => {
    if (!saleId) return;
    const items = returnItems(lines, quantities, picks, confirmed);
    if (items.length === 0) return;
    const pick = await chooseSeller('la devolución');
    if (pick.cancelled) return;
    let authorizationId: string | null = null;
    if (!can(pick.seller, 'return')) {
      authorizationId = await authorize('return', 'la devolución');
      if (!authorizationId) return;
    }
    const result = await createReturn({
      saleId, items, reason, refundMethod, restock,
      sellerSessionId: pick.seller?.sessionId ?? null,
      authorizationId,
    });
    if (!result && pick.seller) dropSession(pick.seller.sessionId);
    if (result) {
      onClose();
      onReturned(result.id);
    }
  };

  const renderStock = (line: ReturnableLine) => {
    if ((quantities[line.line_key] ?? 0) <= 0 || !restock) return null;
    const picked = picks[line.line_key];
    if (picked) {
      return (
        <p className="flex items-center gap-1 text-xs">
          Vuelve al stock de <strong>{picked.label}</strong>
          <button
            type="button"
            aria-label="Quitar la talla elegida"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setPicks(({ [line.line_key]: _quitada, ...rest }) => rest)}
          >
            <X className="h-3 w-3" />
          </button>
        </p>
      );
    }
    if (line.variant_match === 'code') {
      return <p className="text-xs text-muted-foreground">Vuelve al stock de {line.variant_name}</p>;
    }
    const nameMatch = line.variant_match === 'name';
    const isConfirmed = nameMatch && !!confirmed[line.line_key];
    const variantId = resolvedVariant(line, undefined, isConfirmed);
    return (
      <div className="space-y-1">
        {nameMatch && (
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={isConfirmed}
              onCheckedChange={(v) => setConfirmed((prev) => ({ ...prev, [line.line_key]: v === true }))}
            />
            Confirmo que vuelve a {line.variant_name}
          </label>
        )}
        {!variantId && (
          <VariantPicker
            label={`Talla de ${line.product_name}`}
            search={searchVariants}
            onPick={(variant) => setPicks((prev) => ({ ...prev, [line.line_key]: variant }))}
          />
        )}
        {!variantId && !nameMatch && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            Si no está en el catálogo, se devuelve igual, pero este par no vuelve al stock.
          </p>
        )}
      </div>
    );
  };

  return (
    <Dialog open={!!saleId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Devolver o cambiar {ticket?.number ? `· ${ticket.number}` : ''}
          </DialogTitle>
          <DialogDescription>
            Para un cambio de talla, devuelve a vale y cobra lo nuevo en el TPV con ese vale.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !ticket ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : blocked ? (
          <p className="rounded-lg bg-muted p-4 text-sm">{blocked}</p>
        ) : (
          <div className="space-y-4">
            {ticket.over_returned && (
              <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Revisar: entre PYMOVA y Stockagile se ha devuelto de más en este ticket.
              </p>
            )}
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {lines.map((line) => {
                const max = Math.max(line.remaining, 0);
                const unit = line.quantity > 0 ? Number(line.line_total) / line.quantity : 0;
                return (
                  <div key={line.line_key} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{line.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity} {line.quantity === 1 ? 'comprada' : 'compradas'} · {line.returned_stockagile} devueltas en Stockagile ·{' '}
                          {line.returned_pymova} en PYMOVA · {eur(unit)}/ud
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={max}
                        step={1}
                        disabled={max <= 0}
                        aria-label={`Unidades a devolver de ${line.product_name}`}
                        className="w-24"
                        value={quantities[line.line_key] ?? ''}
                        placeholder="0"
                        onChange={(e) => {
                          const value = Math.max(0, Math.min(max, Math.trunc(Number(e.target.value)) || 0));
                          setQuantities((prev) => ({ ...prev, [line.line_key]: value }));
                        }}
                      />
                    </div>
                    {renderStock(line)}
                  </div>
                );
              })}
              {lines.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Este ticket no tiene artículos para devolver.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stockagile-refund-method">Reembolso</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger id="stockagile-refund-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {refundMethods(profile, true).map((m) => (
                      <SelectItem key={m} value={m}>{REFUND_LABELS[m] ?? m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ticket.payment_methods && (
                  <p className="text-xs text-muted-foreground">Se pagó con: {ticket.payment_methods}</p>
                )}
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
                  Reponer al inventario
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stockagile-return-reason">Motivo (opcional)</Label>
              <Textarea
                id="stockagile-return-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Talla incorrecta, producto defectuoso..."
              />
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <span className="text-sm text-muted-foreground">Total a reembolsar</span>
              <span className="text-lg font-semibold">{eur(totalRefund)}</span>
            </div>
            {cashWithoutRegister && (
              <p className="text-sm text-destructive">Abre la caja para devolver en efectivo, o elige otro método de reembolso.</p>
            )}
            {pendingConfirmation && (
              <p className="text-sm text-destructive">Confirma la talla a la que vuelve el par, o elige otra.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!!blocked || !hasUnits || isSubmitting || cashWithoutRegister || pendingConfirmation}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Registrar devolución
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
