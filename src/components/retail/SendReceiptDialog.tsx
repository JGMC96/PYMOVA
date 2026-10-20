import { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canEmailReceipt, usePosClients, type PosClient } from '@/hooks/usePosClients';
import { ClientSearch } from './PosClientPicker';

interface SendReceiptDialogProps {
  /** Venta cuyo ticket se envía; null cierra el diálogo. */
  sale: { id: string; number: string } | null;
  onClose: () => void;
  /** La venta ha cambiado de cliente (para refrescar el historial). */
  onClientChanged?: () => void;
}

type Step = 'loading' | 'pick' | 'consent' | 'confirm';

/**
 * Enviar el ticket por correo. El destinatario es siempre el cliente de la venta y
 * solo si lo ha aceptado: si la venta no tiene cliente, se elige o se da de alta; si
 * no lo ha aceptado, se le pregunta en la tienda y se apunta.
 */
export function SendReceiptDialog({ sale, onClose, onClientChanged }: SendReceiptDialogProps) {
  const { fetchSaleClient, setSaleClient, setReceiptConsent, sendReceipt } = usePosClients();
  const [step, setStep] = useState<Step>('loading');
  const [client, setClient] = useState<PosClient | null>(null);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = (c: PosClient | null) => {
    setClient(c);
    setEmail(c?.email ?? '');
    setConsent(false);
    setStep(!c ? 'pick' : canEmailReceipt(c) ? 'confirm' : 'consent');
  };

  useEffect(() => {
    if (!sale) return;
    setStep('loading');
    let alive = true;
    void fetchSaleClient(sale.id).then((c) => alive && show(c));
    return () => {
      alive = false;
    };
  }, [sale, fetchSaleClient]);

  const send = async () => {
    if (!sale) return;
    setBusy(true);
    const ok = await sendReceipt(sale.id);
    setBusy(false);
    if (ok) onClose();
  };

  const pick = async (c: PosClient) => {
    if (!sale) return;
    setBusy(true);
    const ok = await setSaleClient(sale.id, c.id);
    setBusy(false);
    if (!ok) return;
    onClientChanged?.();
    show(c);
  };

  const saveConsentAndSend = async () => {
    if (!client) return;
    setBusy(true);
    const ok = await setReceiptConsent(client.id, true, client.email ? null : email);
    setBusy(false);
    if (!ok) return;
    const updated = { ...client, email: client.email ?? email.trim().toLowerCase(), receipt_email_consent: true };
    setClient(updated);
    setStep('confirm');
    await send();
  };

  return (
    <Dialog open={!!sale} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Enviar ticket por correo
          </DialogTitle>
          <DialogDescription>{sale?.number}</DialogDescription>
        </DialogHeader>

        {step === 'loading' && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {step === 'pick' && (
          <>
            <p className="text-sm text-muted-foreground">La venta no tiene cliente. Elige o da de alta a quien lo recibe.</p>
            <ClientSearch forReceipt onSelected={pick} />
          </>
        )}

        {step === 'consent' && client && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{client.name}</span> todavía no ha aceptado recibir el ticket por correo.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-email">Correo</Label>
              <Input
                id="receipt-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!!client.email}
              />
              {client.email && (
                <p className="text-xs text-muted-foreground">Para cambiar el correo, edita el cliente en Clientes.</p>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
              <span>El cliente acepta recibir el ticket por correo</span>
            </label>
          </div>
        )}

        {step === 'confirm' && client && (
          <p className="text-sm">
            Se enviará a <span className="font-medium">{client.email}</span> ({client.name}).
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {step === 'consent' && (
            <Button onClick={saveConsentAndSend} disabled={busy || !consent || !email.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar y enviar
            </Button>
          )}
          {step === 'confirm' && (
            <Button onClick={send} disabled={busy} autoFocus>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Enviar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
