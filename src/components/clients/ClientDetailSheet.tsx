// Ficha de clienta (0044): resumen, talla habitual, modelos y todas sus compras de la tienda
// y de la web. Las ventas de tienda se pueden reimprimir.
import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Globe, Loader2, Mail, Phone, Printer, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { SaleReprintDialog } from '@/components/retail/SaleReprintDialog';
import {
  CHANNEL_LABELS, eur, isVoidPurchase, purchaseStatusLabel, usualSizes, type ClientHistory,
} from '@/lib/clientHistory';

/** Lo mínimo para abrir la ficha (sirve la fila de Clientes o la clienta del TPV). */
export interface ClientCard {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes?: string | null;
}

const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy', { locale: es }) : '—');

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ClientDetailSheet({ client, onClose }: { client: ClientCard | null; onClose: () => void }) {
  const { activeBusinessId } = useBusiness();
  const [history, setHistory] = useState<ClientHistory | null>(null);
  const [reprintId, setReprintId] = useState<string | null>(null);
  const closeReprint = useCallback(() => setReprintId(null), []);

  useEffect(() => {
    setHistory(null);
    if (!client || !activeBusinessId) return;
    let cancelled = false;
    // RPC de la 0044: `as never` hasta que se regenere types.ts.
    void supabase
      .rpc('get_client_history' as never, { _business_id: activeBusinessId, _client_id: client.id } as never)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(error.message);
          return;
        }
        setHistory(data as unknown as ClientHistory);
      });
    return () => {
      cancelled = true;
    };
  }, [client, activeBusinessId]);

  const s = history?.summary;
  const sizes = history ? usualSizes(history.sizes) : [];

  return (
    <Sheet open={client !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{client?.name}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {client?.email && (
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{client.email}</span>
              )}
              {client?.phone && (
                <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{client.phone}</span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        {!history ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Compras" value={String(s?.purchases ?? 0)} />
              <Stat label="Gastado" value={eur(s?.spent)} />
              <Stat label="Ticket medio" value={eur(s?.average)} />
              <Stat label="Última compra" value={day(s?.last_purchase_at ?? null)} />
            </div>

            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Clienta desde:</span> {day(s?.first_purchase_at ?? null)}
                {' · '}
                <span className="text-muted-foreground">Tienda:</span> {s?.store_purchases ?? 0}
                {' · '}
                <span className="text-muted-foreground">Web:</span> {s?.online_purchases ?? 0}
                {(s?.returned ?? 0) > 0 && (
                  <>
                    {' · '}
                    <span className="text-muted-foreground">Devoluciones:</span> {s?.returned}
                  </>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Talla habitual:</span>{' '}
                {sizes.length ? sizes.map((t) => <Badge key={t} variant="secondary" className="mr-1">{t}</Badge>) : '—'}
              </p>
              {history.models.length > 0 && (
                <div>
                  <p className="text-muted-foreground">Modelos que más compra:</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {history.models.map((m) => (
                      <Badge key={m.name} variant="outline">
                        {m.name}{Number(m.units) > 1 ? ` ×${m.units}` : ''}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {client?.notes && (
                <p><span className="text-muted-foreground">Notas:</span> {client.notes}</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 font-medium">Historial de compras</h3>
              {history.purchases.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay compras. En el TPV, elige la clienta al cobrar para que sus compras de tienda salgan aquí.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.purchases.map((p) => {
                    const status = purchaseStatusLabel(p);
                    const Icon = p.channel === 'store' ? Store : Globe;
                    return (
                      <li key={`${p.channel}-${p.id}`} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="font-medium">{p.number}</span>
                            <Badge variant="outline">{CHANNEL_LABELS[p.channel]}</Badge>
                            {status && (
                              <Badge variant={isVoidPurchase(p) ? 'destructive' : 'secondary'}>{status}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`tabular-nums ${isVoidPurchase(p) ? 'text-muted-foreground line-through' : 'font-semibold'}`}>
                              {eur(p.total)}
                            </span>
                            {p.channel === 'store' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setReprintId(p.id)}
                                aria-label="Reimprimir ticket"
                                title="Reimprimir ticket"
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{day(p.created_at)}</p>
                        {p.items.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-sm">
                            {p.items.map((it, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className="truncate">{Number(it.quantity) > 1 ? `${it.quantity} × ` : ''}{it.name}</span>
                                {it.total != null && <span className="tabular-nums text-muted-foreground">{eur(it.total)}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
        <SaleReprintDialog saleId={reprintId} onClose={closeReprint} />
      </SheetContent>
    </Sheet>
  );
}
