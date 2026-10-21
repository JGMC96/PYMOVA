import { useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBusiness } from '@/contexts/BusinessContext';
import { invokeShopifySync } from '@/lib/shopify';

interface BatchResult {
  message?: string;
  failed: number;
  created?: number;
  updated?: number;
  partial?: boolean;
  next_cursor?: string | null;
  run_id?: string;
}

/**
 * Integraciones › Shopify: importa los clientes que han comprado en la tienda online, por
 * tandas en el servidor. Después entran solos con cada pedido de la web (avisos de Shopify).
 */
export function ShopifyCustomersCard() {
  const { activeBusinessId } = useBusiness();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ created: number; updated: number; failed: number } | null>(null);

  const run = async () => {
    if (!activeBusinessId) return;
    setRunning(true);
    setProgress({ created: 0, updated: 0, failed: 0 });
    try {
      let after: string | null = null;
      let runId: string | null = null;
      let result: BatchResult;
      for (let batch = 0; ; batch++) {
        result = await invokeShopifySync<BatchResult>({
          action: 'sync',
          business_id: activeBusinessId,
          scope: 'customers',
          after,
          run_id: runId,
          max_pages: 3,
        });
        setProgress({ created: result.created ?? 0, updated: result.updated ?? 0, failed: result.failed ?? 0 });
        if (!result.partial || !result.next_cursor || batch >= 200) break;
        after = result.next_cursor;
        runId = result.run_id ?? runId;
      }
      if (result.failed > 0) {
        toast.warning('Clientes importados con incidencias', { description: result.message });
      } else {
        toast.success('Clientes importados', { description: result.message });
      }
    } catch (err) {
      toast.error('No se pudieron importar los clientes', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5" />
            Clientes de Shopify
          </CardTitle>
          <CardDescription>
            Trae a Clientes a quienes han comprado en la tienda online: nombre, correo, teléfono e id de Shopify. Se
            emparejan por el id de Shopify o por el correo, sin duplicar. Después entran solos con cada pedido de la
            web y se actualizan si cambian en Shopify (con los avisos automáticos activos). El permiso para enviarles el
            ticket por correo no se importa: se pregunta en la tienda.
          </CardDescription>
        </div>
        <Button onClick={() => void run()} disabled={running} className="shrink-0">
          {running && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Importar clientes
        </Button>
      </CardHeader>
      {progress && (
        <CardContent className="text-sm text-muted-foreground">
          {running ? 'Importando… ' : 'Último resultado: '}
          {progress.created} nuevos · {progress.updated} actualizados
          {progress.failed > 0 ? ` · ${progress.failed} con error` : ''}
        </CardContent>
      )}
    </Card>
  );
}
