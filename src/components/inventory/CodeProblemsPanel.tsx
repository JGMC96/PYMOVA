import { useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useCodeProblems } from '@/hooks/useCodeProblems';
import {
  affectedCount, codeProblemsCsv, findCodeProblems, SHOPIFY_STATUS_LABELS,
  type CodeGroup, type CodeRow,
} from '@/lib/codeProblems';
import { downloadCsv } from '@/lib/informes';

const today = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ row }: { row: CodeRow }) {
  if (row.active) return null;
  return <Badge variant="outline" className="ml-2 font-normal text-muted-foreground">{SHOPIFY_STATUS_LABELS[row.status]}</Badge>;
}

function GroupList({ groups, codeOf }: { groups: CodeGroup[]; codeOf: (r: CodeRow) => string | null }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.code} className="rounded-md border p-3">
          <p className="font-mono text-sm font-medium">{g.code}</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {g.rows.map((r) => (
              <li key={r.key}>
                {r.productName}{r.size ? ` · ${r.size}` : ''}
                {codeOf(r) !== g.code && <span className="ml-2 font-mono text-xs text-muted-foreground">({codeOf(r)})</span>}
                <StatusBadge row={r} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Tallas sin código, agrupadas por producto. */
function MissingList({ rows }: { rows: CodeRow[] }) {
  const byProduct = useMemo(() => {
    const map = new Map<string, CodeRow[]>();
    for (const r of rows) map.set(r.productId, [...(map.get(r.productId) ?? []), r]);
    return [...map.values()];
  }, [rows]);
  return (
    <div className="space-y-2">
      {byProduct.map((list) => (
        <div key={list[0].productId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{list[0].productName}</span>
          {list[0].size === null ? (
            <StatusBadge row={list[0]} />
          ) : (
            list.map((r) => (
              <Badge key={r.key} variant={r.active ? 'secondary' : 'outline'} className="font-normal">
                {r.size}
              </Badge>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Códigos con problemas: SKU repetidos o vacíos y tallas sin código de barras. Solo se
 * enseñan y se sacan a CSV: con Stockagile o Shopify conectados se corrigen allí.
 */
export function CodeProblemsPanel() {
  const { canEditCatalog, isLoading: permsLoading } = useMyPermissions();
  const { rows, isLoading, error, reload } = useCodeProblems();
  const [scope, setScope] = useState<'active' | 'all'>('active');

  const report = useMemo(() => findCodeProblems(rows, { onlyActive: scope === 'active' }), [rows, scope]);
  const skuRows = report.duplicateSkus.reduce((n, g) => n + g.rows.length, 0);

  if (permsLoading) return null;
  if (!canEditCatalog) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Para ver esta pantalla hace falta el permiso «Productos y precios».
      </Card>
    );
  }

  const exportCsv = () => downloadCsv(`codigos-con-problemas-${today()}.csv`, codeProblemsCsv(report, rows));

  const sections = [
    {
      key: 'dup-sku',
      title: 'SKU repetidos',
      count: `${report.duplicateSkus.length} SKU en ${skuRows} tallas`,
      empty: report.duplicateSkus.length === 0,
      body: <GroupList groups={report.duplicateSkus} codeOf={(r) => r.sku} />,
    },
    {
      key: 'no-sku',
      title: 'Tallas sin SKU',
      count: `${report.missingSku.length} tallas`,
      empty: report.missingSku.length === 0,
      body: <MissingList rows={report.missingSku} />,
    },
    {
      key: 'no-barcode',
      title: 'Tallas sin código de barras',
      count: `${report.missingBarcode.length} tallas`,
      empty: report.missingBarcode.length === 0,
      body: <MissingList rows={report.missingBarcode} />,
    },
    ...(report.duplicateBarcodes.length > 0
      ? [{
          key: 'dup-barcode',
          title: 'Códigos de barras repetidos',
          count: `${report.duplicateBarcodes.length} códigos`,
          empty: false,
          body: <GroupList groups={report.duplicateBarcodes} codeOf={(r) => r.barcode} />,
        }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-muted-foreground">
        Un SKU repetido hace que el stock o una venta caigan en la talla equivocada, y sin SKU el producto
        no entra en Google Shopping. Corrígelos donde nacen los códigos (Stockagile o Shopify): si se cambian
        en PYMOVA, la siguiente sincronización vuelve a poner los de allí. El CSV lleva la lista para pasarla.
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Tallas</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as 'active' | 'all')}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">A la venta</SelectItem>
              <SelectItem value="all">Todas (también inactivas)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={isLoading}>
          <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
        </Button>
        <Button onClick={exportCsv} disabled={isLoading || affectedCount(report) === 0}>
          <Download className="w-4 h-4 mr-2" /> CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Revisando el catálogo…
        </div>
      ) : error ? (
        <Card className="p-4 text-sm text-destructive">{error}</Card>
      ) : affectedCount(report) === 0 ? (
        <Card className="p-6 text-sm">No hay códigos con problemas.</Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {affectedCount(report)} tallas con algún problema. Los repetidos se buscan en todo el catálogo, también en
            las tallas inactivas.
          </p>
          <Accordion type="multiple" defaultValue={['dup-sku']} className="space-y-2">
            {sections.map((s) => (
              <AccordionItem key={s.key} value={s.key} className="rounded-lg border px-4">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex flex-wrap items-baseline gap-2 text-left">
                    <span className="font-medium">{s.title}</span>
                    <span className="text-sm font-normal text-muted-foreground">{s.count}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  {s.empty ? <p className="text-sm text-muted-foreground">Ninguno.</p> : s.body}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}
