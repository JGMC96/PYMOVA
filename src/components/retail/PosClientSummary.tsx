// Resumen de la clienta elegida en el TPV (0044): compras, gasto, talla habitual y última
// compra, para atenderla sabiendo qué suele llevar. «Ver ficha» abre todo su historial.
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { ClientDetailSheet, type ClientCard } from '@/components/clients/ClientDetailSheet';
import { posClientSummaryText, usualSizes, type ClientHistory } from '@/lib/clientHistory';

export function PosClientSummary({ client }: { client: ClientCard }) {
  const { activeBusinessId } = useBusiness();
  const [history, setHistory] = useState<ClientHistory | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setHistory(null);
    if (!activeBusinessId) return;
    let cancelled = false;
    // RPC de la 0044: `as never` hasta que se regenere types.ts.
    void supabase
      .rpc('get_client_history' as never, { _business_id: activeBusinessId, _client_id: client.id } as never)
      .then(({ data, error }) => {
        if (!cancelled && !error) setHistory(data as unknown as ClientHistory);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId, client.id]);

  if (!history) return null;
  const last = history.summary.last_purchase_at
    ? format(new Date(history.summary.last_purchase_at), 'd MMM yyyy', { locale: es })
    : null;

  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span className="truncate">
          {posClientSummaryText(history.summary.purchases, history.summary.spent, usualSizes(history.sizes), last)}
        </span>
        <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => setOpen(true)}>
          Ver ficha
        </button>
      </div>
      <ClientDetailSheet client={open ? client : null} onClose={() => setOpen(false)} />
    </>
  );
}
