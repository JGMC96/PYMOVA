import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportCsvButton, PeriodSelector } from '@/components/informes/InformeControles';
import { useInformePeriod } from '@/hooks/useInformePeriod';
import { useSalesReport } from '@/hooks/useSalesReport';
import { averageTicket, methodLabel, salesReportCsv, variation } from '@/lib/informes';
import { fmt, parseYmd } from '@/lib/periodos';
import { cn } from '@/lib/utils';

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('es-ES').format(n || 0);

/** Variación respecto al año anterior: verde si sube, rojo si baja, «—» si no hay con qué comparar. */
function Variation({ current, previous }: { current: number; previous: number }) {
  const v = variation(current, previous);
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const text = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
  return <span className={cn('font-medium', v > 0 && 'text-emerald-600', v < 0 && 'text-destructive')}>{text}</span>;
}

function Kpi({ title, value, previous, current, hint }: { title: string; value: string; current: number; previous: number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <Variation current={current} previous={previous} /> frente al año anterior
        {hint && <div>{hint}</div>}
      </CardContent>
    </Card>
  );
}

const dayLabel = (d: string) => parseYmd(d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });

export function SalesReportPanel() {
  const period = useInformePeriod('month');
  const { data: r, isLoading, isFetching, error } = useSalesReport(period.from, period.to, !period.invalid);

  const bySrc = (src: 'pymova' | 'stockagile', per: 'cur' | 'prev') => r?.by_source.find((x) => x.src === src && x.per === per);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-6">
          <PeriodSelector
            preset={period.preset}
            from={period.from}
            to={period.to}
            onPreset={period.choosePreset}
            onFrom={period.setFrom}
            onTo={period.setTo}
          />
          <ExportCsvButton
            filename={`ventas_${period.from}_${period.to}.csv`}
            build={() => salesReportCsv(r!)}
            disabled={!r || isFetching}
          />
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          No se pudo cargar el informe: {(error as Error).message}
        </p>
      )}

      {isLoading && !r && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculando…
        </p>
      )}

      {r && (
        <div className={cn('space-y-6', isFetching && 'opacity-60')}>
          <p className="text-sm text-muted-foreground">
            Del {fmt(r.period.from)} al {fmt(r.period.to)}, comparado con del {fmt(r.previous.from)} al {fmt(r.previous.to)}.
            Suma las ventas de PYMOVA y los tickets de Stockagile. Importes con IVA, sin propinas.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              title="Ventas netas"
              value={eur(r.current.net_total)}
              current={r.current.net_total}
              previous={r.prior.net_total}
              hint="Ventas menos devoluciones"
            />
            <Kpi
              title="Tickets de venta"
              value={num(r.current.sales_count)}
              current={r.current.sales_count}
              previous={r.prior.sales_count}
            />
            <Kpi
              title="Ticket medio"
              value={eur(averageTicket(r.current))}
              current={averageTicket(r.current)}
              previous={averageTicket(r.prior)}
              hint="Neto entre tickets de venta"
            />
            <Kpi
              title="Devoluciones"
              value={eur(r.current.returns_total)}
              current={r.current.returns_total}
              previous={r.prior.returns_total}
              hint={`${num(r.current.returns_count)} tickets${
                r.current.exchanges_count ? ` · ${num(r.current.exchanges_count)} cambios con diferencia (${eur(r.current.exchanges_total)})` : ''
              }`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por origen</CardTitle>
              <CardDescription>De dónde vienen las ventas: la caja de PYMOVA o los tickets copiados de Stockagile.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origen</TableHead>
                    <TableHead className="text-right">Tickets</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                    <TableHead className="text-right">Año anterior</TableHead>
                    <TableHead className="text-right">Variación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(['pymova', 'stockagile'] as const).map((src) => {
                    const cur = bySrc(src, 'cur');
                    const prev = bySrc(src, 'prev');
                    return (
                      <TableRow key={src}>
                        <TableCell className="font-medium">{src === 'pymova' ? 'PYMOVA' : 'Stockagile'}</TableCell>
                        <TableCell className="text-right">{num(cur?.sales_count ?? 0)}</TableCell>
                        <TableCell className="text-right">{eur(cur?.net_total ?? 0)}</TableCell>
                        <TableCell className="text-right">{eur(prev?.net_total ?? 0)}</TableCell>
                        <TableCell className="text-right">
                          <Variation current={cur?.net_total ?? 0} previous={prev?.net_total ?? 0} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por forma de pago</CardTitle>
              <CardDescription>
                Stockagile solo guarda el nombre del pago: los tickets pagados con efectivo y tarjeta salen juntos, sin
                desglose, y los que no traen dato, en «Sin dato».
              </CardDescription>
            </CardHeader>
            <CardContent>
              {r.by_payment.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Sin ventas en ese periodo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Forma de pago</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead className="text-right">Ventas</TableHead>
                      <TableHead className="text-right">Neto</TableHead>
                      <TableHead className="text-right">Año anterior</TableHead>
                      <TableHead className="text-right">Variación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.by_payment.map((p) => (
                      <TableRow key={p.m}>
                        <TableCell className="font-medium">{methodLabel(p.m)}</TableCell>
                        <TableCell className="text-right">{num(p.cur_count)}</TableCell>
                        <TableCell className="text-right">{eur(p.cur_sales)}</TableCell>
                        <TableCell className="text-right">{eur(p.cur_net)}</TableCell>
                        <TableCell className="text-right">{eur(p.prev_net)}</TableCell>
                        <TableCell className="text-right">
                          <Variation current={p.cur_net} previous={p.prev_net} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por vendedor</CardTitle>
              <CardDescription>
                Las devoluciones se restan a quien las hizo. Los tickets de Stockagile no guardan vendedor: van juntos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {r.by_seller.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Sin ventas en ese periodo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead className="text-right">Ventas</TableHead>
                      <TableHead className="text-right">Neto</TableHead>
                      <TableHead className="text-right">Año anterior</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.by_seller.map((s) => (
                      <TableRow key={s.seller_key}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-right">{num(s.cur_count)}</TableCell>
                        <TableCell className="text-right">{eur(s.cur_sales)}</TableCell>
                        <TableCell className="text-right">{eur(s.cur_net)}</TableCell>
                        <TableCell className="text-right">{eur(s.prev_net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por día</CardTitle>
              <CardDescription>Cada día se compara con el mismo día del año anterior (misma fecha, no mismo día de la semana).</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[28rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead className="text-right">Tickets</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                    <TableHead className="text-right">Tickets año anterior</TableHead>
                    <TableHead className="text-right">Neto año anterior</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.by_day.map((d) => (
                    <TableRow key={d.date} className={d.cur_count === 0 && d.cur_net === 0 ? 'text-muted-foreground' : undefined}>
                      <TableCell>{dayLabel(d.date)}</TableCell>
                      <TableCell className="text-right">{num(d.cur_count)}</TableCell>
                      <TableCell className="text-right">{eur(d.cur_net)}</TableCell>
                      <TableCell className="text-right">{num(d.prev_count)}</TableCell>
                      <TableCell className="text-right">{eur(d.prev_net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
