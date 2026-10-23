import { useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBusiness } from '@/contexts/BusinessContext';
import { supabase } from '@/integrations/supabase/client';
import { STOCKAGILE_PILOT_BUSINESS_ID } from '../../../supabase/functions/_shared/stockagile-core.ts';
import { StockagileSalesHistoryImport } from './StockagileSalesHistoryImport';

interface CheckResult {
  ok: boolean;
  location_name: string | null;
  warehouse: { id: number; name: string } | null;
  warehouses: { id: number; name: string; is_principal: boolean }[];
  matches: {
    variant_id: string;
    product: string;
    size: string | null;
    pymova_stock: number | null;
    matched_by: 'barcode' | 'shopify-product' | null;
    stockagile_variant_id: number | null;
    stockagile_stock: number | null;
    note: string | null;
  }[];
}

const MATCHED_BY: Record<string, string> = {
  barcode: 'Código de barras',
  'shopify-product': 'Producto de Shopify y talla',
};

/** Mensaje de error de una edge function (el cuerpo trae `{ error }`). */
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // sin cuerpo JSON
    }
  }
  return (error as { message?: string } | null)?.message || 'No se pudo comprobar Stockagile';
}

/**
 * Integraciones › Shopify: comprobación de solo lectura de la conexión con Stockagile
 * (piloto TUILUS). Muestra el almacén emparejado y el stock de las últimas variantes vendidas
 * en PYMOVA y en Stockagile.
 */
export function StockagileCheckPanel() {
  const { activeBusinessId } = useBusiness();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [running, setRunning] = useState(false);

  if (activeBusinessId !== STOCKAGILE_PILOT_BUSINESS_ID) return null;

  const run = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke('stockagile', {
      body: { action: 'check', business_id: activeBusinessId },
    });
    setRunning(false);
    if (error) {
      setResult(null);
      toast.error(await functionErrorMessage(error));
      return;
    }
    setResult(data as CheckResult);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <PlugZap className="w-5 h-5" />
            Stockagile
          </CardTitle>
          <CardDescription>
            Comprueba, sin cambiar nada, que PYMOVA lee Stockagile: el almacén de la tienda y el stock de las últimas
            variantes vendidas en los dos sitios.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => void run()} disabled={running}>
          {running && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Comprobar Stockagile
        </Button>
      </CardHeader>
      <CardContent className={result ? 'pb-0' : undefined}>
        <StockagileSalesHistoryImport />
      </CardContent>
      {result && (
        <CardContent className="space-y-4">
          <div className="text-sm flex flex-wrap items-center gap-2">
            {result.warehouse ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Almacén de Stockagile: <span className="font-medium">{result.warehouse.name}</span>
                <span className="text-muted-foreground">(id {result.warehouse.id})</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-destructive" />
                Ningún almacén se llama como la ubicación de Shopify «{result.location_name ?? '—'}». Almacenes:{' '}
                {result.warehouses.map((w) => w.name).join(', ') || '—'}
              </>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead>Emparejado por</TableHead>
                <TableHead className="text-right">Stock PYMOVA</TableHead>
                <TableHead className="text-right">Stock Stockagile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.matches.map((m) => {
                const differs =
                  m.stockagile_stock != null && m.pymova_stock != null && m.stockagile_stock !== m.pymova_stock;
                return (
                  <TableRow key={m.variant_id}>
                    <TableCell>
                      <div className="font-medium">{m.product}</div>
                      <div className="text-xs text-muted-foreground">{m.size ?? ''}</div>
                    </TableCell>
                    <TableCell>
                      {m.matched_by ? (
                        <Badge variant="secondary">{MATCHED_BY[m.matched_by]}</Badge>
                      ) : (
                        <span className="text-sm text-destructive">{m.note ?? 'Sin emparejar'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{m.pymova_stock ?? '—'}</TableCell>
                    <TableCell className={differs ? 'text-right font-semibold text-destructive' : 'text-right'}>
                      {m.stockagile_stock ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
