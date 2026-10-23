// Integraciones › Shopify › Stockagile: traer una vez todas las ventas de la tienda hechas en
// Stockagile (0046), por tandas. Solo copia para consultar: no mueve stock. Se puede repetir.
import { useRef, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBusiness } from '@/contexts/BusinessContext';
import { supabase } from '@/integrations/supabase/client';
import { functionError } from '@/hooks/useStockagileSales';

interface Chunk {
  saved: number;
  seen: number;
  count: number | null;
  next_page: number | null;
  done: boolean;
}

export function StockagileSalesHistoryImport() {
  const { activeBusinessId } = useBusiness();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ seen: number; saved: number; count: number | null } | null>(null);
  const stop = useRef(false);

  const run = async () => {
    if (!activeBusinessId) return;
    stop.current = false;
    setRunning(true);
    let state = { seen: 0, saved: 0, count: null as number | null };
    setProgress(state);
    let page: number | null = 1;
    try {
      while (page) {
        const { data, error } = await supabase.functions.invoke('stockagile', {
          body: { action: 'import-sales-history', business_id: activeBusinessId, page },
        });
        if (error) throw new Error(await functionError(error, 'No se pudo traer el historial de Stockagile'));
        const chunk = data as Chunk;
        state = { seen: state.seen + chunk.seen, saved: state.saved + chunk.saved, count: chunk.count ?? state.count };
        setProgress(state);
        page = chunk.done ? null : chunk.next_page;
        if (stop.current) {
          toast.info('Importación detenida. Puedes volver a lanzarla: no duplica ventas.');
          break;
        }
      }
      if (!stop.current) toast.success(`Historial de Stockagile copiado: ${state.saved} ventas de la tienda`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo traer el historial de Stockagile', {
        description: 'Lo copiado se queda. Vuelve a lanzarla para seguir: no duplica ventas.',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Ventas de la tienda en Stockagile: copia para consultarlas en PYMOVA (historial y ficha de clientas).
        </span>
        <div className="flex gap-2">
          {running && (
            <Button variant="ghost" size="sm" onClick={() => { stop.current = true; }}>
              Detener
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <History className="w-4 h-4 mr-2" />}
            Importar historial de ventas
          </Button>
        </div>
      </div>
      {progress && (
        <div className="space-y-1">
          <p className="text-muted-foreground tabular-nums">
            {progress.seen.toLocaleString('es-ES')}
            {progress.count ? ` de ${progress.count.toLocaleString('es-ES')}` : ''} tickets revisados ·{' '}
            {progress.saved.toLocaleString('es-ES')} de la tienda copiados
          </p>
          {progress.count ? <Progress value={Math.min(100, Math.round((progress.seen / progress.count) * 100))} /> : null}
        </div>
      )}
    </div>
  );
}
