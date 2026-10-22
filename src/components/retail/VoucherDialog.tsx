import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import {
  normalizeVoucherCode, parseVoucherAmount, voucherApplied, voucherProblem, type StoreVoucher,
} from '@/lib/vales';

export interface AppliedVoucher {
  code: string;
  amount: number;
  balance: number;
}

/** Pagar con vale de tienda: se escanea o escribe el código, se ve el saldo y se elige cuánto usar. */
export function VoucherDialog({
  open,
  onOpenChange,
  total,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Total de la venta (IVA incluido, sin propina): el vale no paga más. */
  total: number;
  onApply: (voucher: AppliedVoucher) => void;
}) {
  const { activeBusiness } = useBusiness();
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<StoreVoucher | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setVoucher(null);
      setAmount('');
      setError(null);
    }
  }, [open]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const wanted = normalizeVoucherCode(code);
    if (!wanted || !activeBusiness?.id) return;
    setSearching(true);
    setError(null);
    setVoucher(null);
    // Función nueva de la 0039: `as never` hasta que se regenere types.ts.
    const { data, error: rpcError } = await supabase.rpc('get_store_voucher' as never, {
      _business_id: activeBusiness.id,
      _code: wanted,
    } as never);
    setSearching(false);
    if (rpcError) {
      setError(rpcError.message || 'No se pudo consultar el vale');
      return;
    }
    const found = ((data ?? []) as StoreVoucher[])[0];
    if (!found) {
      setError(`No hay ningún vale con el código ${wanted}`);
      return;
    }
    const v = { ...found, balance: Number(found.balance), initial_amount: Number(found.initial_amount) };
    setVoucher(v);
    const problem = voucherProblem(v);
    if (problem) setError(problem);
    else setAmount(voucherApplied(v.balance, v.balance, total).toFixed(2).replace('.', ','));
  };

  const apply = () => {
    if (!voucher || voucherProblem(voucher)) return;
    const requested = parseVoucherAmount(amount);
    if (requested == null) {
      setError('Escribe el importe que se paga con el vale');
      return;
    }
    if (requested > voucher.balance) {
      setError(`El vale solo tiene ${voucher.balance.toFixed(2)} € de saldo`);
      return;
    }
    if (requested > total) {
      setError(`El vale no puede pagar más que el total (${total.toFixed(2)} €)`);
      return;
    }
    onApply({ code: voucher.code, amount: requested, balance: voucher.balance });
    onOpenChange(false);
  };

  const usable = voucher && !voucherProblem(voucher);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pagar con vale</DialogTitle>
          <DialogDescription>Escanea o escribe el código del vale de tienda.</DialogDescription>
        </DialogHeader>
        <form onSubmit={search} className="flex gap-2">
          <Input
            aria-label="Código del vale"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="VALE-XXXXXXXX"
            className="uppercase"
            autoFocus
          />
          <Button type="submit" variant="outline" disabled={searching || !code.trim()}>
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
          </Button>
        </form>

        {voucher && (
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Vale</span><span className="font-medium">{voucher.code}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Saldo</span><span className="font-semibold">{voucher.balance.toFixed(2)} €</span></div>
            {voucher.expires_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Válido hasta</span>
                <span>{new Date(voucher.expires_at).toLocaleDateString('es-ES')}</span>
              </div>
            )}
          </div>
        )}

        {usable && (
          <div className="space-y-1.5">
            <Label htmlFor="voucher-amount">Importe a pagar con el vale</Label>
            <Input
              id="voucher-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">Lo que no se use se queda de saldo en el vale.</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={apply} disabled={!usable}>
            Aplicar vale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
