import { useMemo, useState } from 'react';
import { CheckCircle2, Download, Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useVariantAudit } from '@/hooks/useVariantAudit';
import { MISMATCH_LABELS, type MismatchCode } from '@/lib/variantMapping';

interface Props {
  query?: string;
}

export const VariantMappingReport = ({ query = '' }: Props) => {
  const {
    mismatches,
    countsByCode,
    isAuditing,
    progress,
    lastRunAt,
    runAudit,
    toggleResolved,
    exportCsv,
  } = useVariantAudit();

  const [filter, setFilter] = useState<'all' | MismatchCode>('all');

  const visible = useMemo(
    () => mismatches.filter((m) => filter === 'all' || m.issue_code === filter),
    [mismatches, filter],
  );

  const unresolved = mismatches.filter((m) => !m.resolved).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-accent" />
            Mapeo y validación de variantes
          </CardTitle>
          <CardDescription>
            Compara cada variante de Shopify con la de Pymova (por ID de Shopify, SKU, código de
            barras o nombre) y explica por qué algunos ítems no actualizan stock.
            {lastRunAt && ` Última revisión: ${new Date(lastRunAt).toLocaleString('es-ES')}.`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {mismatches.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
          )}
          <Button size="sm" onClick={() => runAudit(query)} disabled={isAuditing}>
            {isAuditing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4 mr-2" />
            )}
            {isAuditing ? `Validando… (${progress})` : 'Validar mapeo'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(MISMATCH_LABELS) as MismatchCode[]).map((code) => (
            <Badge
              key={code}
              variant={countsByCode[code] ? 'destructive' : 'secondary'}
              className="cursor-pointer"
              onClick={() => setFilter(filter === code ? 'all' : code)}
            >
              {MISMATCH_LABELS[code]}: {countsByCode[code] ?? 0}
            </Badge>
          ))}
          <Select value={filter} onValueChange={(v) => setFilter(v as 'all' | MismatchCode)}>
            <SelectTrigger className="w-56 h-8 ml-auto">
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los desajustes</SelectItem>
              {(Object.keys(MISMATCH_LABELS) as MismatchCode[]).map((code) => (
                <SelectItem key={code} value={code}>
                  {MISMATCH_LABELS[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mismatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no has validado el mapeo. Pulsa «Validar mapeo» para generar el informe.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay desajustes de este tipo.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {unresolved} desajustes sin resolver de {mismatches.length} detectados.
            </p>
            <ScrollArea className="max-h-96 rounded-md border">
              <ul className="divide-y text-sm">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className={`px-3 py-2 space-y-1 ${m.resolved ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{MISMATCH_LABELS[m.issue_code as MismatchCode]}</Badge>
                      <span className="font-medium truncate">
                        {m.product_name}
                        {m.variant_name ? ` · ${m.variant_name}` : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7"
                        onClick={() => toggleResolved(m.id, !m.resolved)}
                      >
                        <CheckCircle2
                          className={`w-4 h-4 mr-1 ${m.resolved ? 'text-emerald-500' : ''}`}
                        />
                        {m.resolved ? 'Resuelto' : 'Marcar resuelto'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{m.details}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>SKU: {m.sku || '—'}</span>
                      <span>Código: {m.barcode || '—'}</span>
                      <span>Stock Shopify: {m.external_stock ?? '—'}</span>
                      <span>Stock Pymova: {m.local_stock ?? '—'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
};
