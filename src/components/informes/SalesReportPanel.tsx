import { useState, type ReactNode } from 'react';
import { Globe, Loader2, RefreshCw, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportCsvButton, PeriodSelector } from '@/components/informes/InformeControles';
import { useInformePeriod } from '@/hooks/useInformePeriod';
import { useSalesReport } from '@/hooks/useSalesReport';
import {
  averageTicket, CHANNEL_LABEL, methodLabel, monthName, rowTotals, salesReportCsv, variation,
  type LiveSalesReport, type PeriodRow, type SalesChannel,
} from '@/lib/informes';
import { fmt, parseYmd, ymd } from '@/lib/periodos';
import { cn } from '@/lib/utils';

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('es-ES').format(n || 0);
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Variación respecto al año anterior: verde si sube, rojo si baja, «—» si no hay con qué comparar. */
function Variation({ current, previous }: { current: number; previous: number }) {
  const v = variation(current, previous);
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const text = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
  return <span className={cn('font-medium', v > 0 && 'text-emerald-500', v < 0 && 'text-red-500')}>{text}</span>;
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

function Section({ title, description, children, scroll }: { title: string; description?: string; children: ReactNode; scroll?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn(scroll && 'max-h-[28rem] overflow-y-auto')}>{children}</CardContent>
    </Card>
  );
}

const Num = ({ children, strong }: { children: ReactNode; strong?: boolean }) => (
  <TableCell className={cn('text-right', strong && 'font-semibold')}>{children}</TableCell>
);
const Head = ({ children }: { children: ReactNode }) => <TableHead className="text-right">{children}</TableHead>;

/** Tabla de meses o de días: tienda, online, total y año anterior. */
function PeriodTable({ first, rows, channel }: { first: string; rows: Array<PeriodRow & { key: string; label: string }>; channel: SalesChannel }) {
  const both = channel === 'all';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{first}</TableHead>
          <Head>Tickets</Head>
          {both && <Head>Tienda</Head>}
          {both && <Head>Online</Head>}
          <Head>{both ? 'Total' : 'Neto'}</Head>
          <Head>Año anterior</Head>
          <Head>Variación</Head>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const t = rowTotals(r);
          return (
            <TableRow key={r.key} className={r.cur_count === 0 && t.cur === 0 ? 'text-muted-foreground' : undefined}>
              <TableCell>{r.label}</TableCell>
              <Num>{num(r.cur_count)}</Num>
              {both && <Num>{eur(r.cur_store)}</Num>}
              {both && <Num>{eur(r.cur_online)}</Num>}
              <Num strong>{eur(t.cur)}</Num>
              <Num>{eur(t.prev)}</Num>
              <Num>
                <Variation current={t.cur} previous={t.prev} />
              </Num>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** «El 26/11/2026» o «Del 1/11/2026 al 26/11/2026». */
const range = (p: { from: string; to: string }) =>
  p.from === p.to ? `El ${fmt(p.from)}` : `Del ${fmt(p.from)} al ${fmt(p.to)}`;

const dayLabel = (d: string) => parseYmd(d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });

/** Hora de una venta; con la fecha delante si no es de hoy. */
function saleWhen(iso: string, today: string) {
  const d = new Date(iso);
  return ymd(d) === today ? hour(iso) : `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${hour(iso)}`;
}

function Latest({ r, today }: { r: LiveSalesReport; today: string }) {
  return (
    <Section title="Últimas ventas" description="Las 10 más recientes, sea cual sea el periodo. Sin datos de clientas.">
      {r.latest.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay ventas.</p>
      ) : (
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {r.latest.map((s, i) => (
            <li key={`${s.at}-${i}`} className="flex items-center justify-between gap-3 border-b pb-2 text-sm">
              <span className="flex items-center gap-2">
                {s.channel === 'online' ? <Globe className="w-4 h-4 text-muted-foreground" /> : <Store className="w-4 h-4 text-muted-foreground" />}
                <span className="tabular-nums">{saleWhen(s.at, today)}</span>
                <span className="text-muted-foreground">{CHANNEL_LABEL[s.channel]}</span>
              </span>
              <span className="font-medium tabular-nums">{eur(s.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SalesReportPanel() {
  const period = useInformePeriod('today');
  const [channel, setChannel] = useState<SalesChannel>('all');
  const { data: r, isLoading, isFetching, isPlaceholderData, error, refetch, dataUpdatedAt } = useSalesReport(
    period.from,
    period.to,
    channel,
    { enabled: !period.invalid, live: period.isLive },
  );

  const store = r?.by_channel.find((c) => c.channel === 'store');
  const online = r?.by_channel.find((c) => c.channel === 'online');
  const source = (src: 'pymova' | 'stockagile') => r?.by_source.find((x) => x.src === src && x.per === 'cur')?.net_total ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <PeriodSelector
              preset={period.preset}
              from={period.from}
              to={period.to}
              month={period.month}
              today={period.today}
              onPreset={period.choosePreset}
              onMonth={period.setMonth}
              onFrom={period.setFrom}
              onTo={period.setTo}
            />
            <ExportCsvButton
              filename={`ventas_${channel === 'all' ? '' : `${channel}_`}${period.from}_${period.to}.csv`}
              build={() => salesReportCsv(r!)}
              disabled={!r || isPlaceholderData}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border p-1" role="group" aria-label="Canal de venta">
              {(['all', 'store', 'online'] as const).map((c) => (
                <Button key={c} size="sm" variant={channel === c ? 'default' : 'ghost'} aria-pressed={channel === c} onClick={() => setChannel(c)}>
                  {CHANNEL_LABEL[c]}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {dataUpdatedAt > 0 && (
                <span>
                  Actualizado a las {hour(new Date(dataUpdatedAt).toISOString())}
                  {period.isLive && ' · se actualiza solo cada minuto'}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || period.invalid}>
                <RefreshCw className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin')} />
                Actualizar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {r && !isPlaceholderData
            ? `No se pudo actualizar; se ven las últimas cifras. ${(error as Error).message}`
            : `No se pudo cargar el informe: ${(error as Error).message}`}
        </p>
      )}

      {isLoading && !r && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculando…
        </p>
      )}

      {r && (
        <div className={cn('space-y-6', isPlaceholderData && 'opacity-60')}>
          <p className="text-sm text-muted-foreground">
            {range(r.period)}, comparado con {range(r.previous).toLowerCase()}
            {r.prior_until && ` hasta las ${r.prior_until}`}. Importes con IVA. Tienda: caja de PYMOVA y tickets de
            Stockagile. Online: pedidos de Shopify con envío, sin cancelados; las devoluciones restan en la fecha del pedido.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              title="Ventas netas"
              value={eur(r.current.net_total)}
              current={r.current.net_total}
              previous={r.prior.net_total}
              hint={r.channel === 'all' ? `Tienda ${eur(store?.cur_net ?? 0)} · Online ${eur(online?.cur_net ?? 0)}` : undefined}
            />
            <Kpi title="Tickets de venta" value={num(r.current.sales_count)} current={r.current.sales_count} previous={r.prior.sales_count} />
            <Kpi
              title="Ticket medio"
              value={eur(averageTicket(r.current))}
              current={averageTicket(r.current)}
              previous={averageTicket(r.prior)}
              hint="Neto entre tickets de venta"
            />
            {r.channel === 'online' ? (
              <Kpi
                title="Pedidos devueltos"
                value={num(r.current.online_returned_count)}
                current={r.current.online_returned_count}
                previous={r.prior.online_returned_count}
                hint={`Envío incluido: ${eur(r.current.shipping_total)}`}
              />
            ) : (
              <Kpi
                title="Devoluciones en tienda"
                value={eur(r.current.returns_total)}
                current={r.current.returns_total}
                previous={r.prior.returns_total}
                hint={`${num(r.current.returns_count)} tickets${
                  r.current.exchanges_count ? ` · ${num(r.current.exchanges_count)} cambios con diferencia (${eur(r.current.exchanges_total)})` : ''
                }`}
              />
            )}
          </div>

          <Section title="Tienda y online" description="Siempre las dos, aunque arriba se filtre por una.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <Head>Tickets</Head>
                  <Head>Neto</Head>
                  <Head>Año anterior</Head>
                  <Head>Variación</Head>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.by_channel.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="font-medium">
                      {CHANNEL_LABEL[c.channel]}
                      {c.channel === 'online' && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Envío incluido: {eur(c.cur_shipping)} · pedidos devueltos: {num(c.cur_returned)}
                        </span>
                      )}
                      {c.channel === 'store' && r.channel !== 'online' && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          PYMOVA {eur(source('pymova'))} · Stockagile {eur(source('stockagile'))}
                        </span>
                      )}
                    </TableCell>
                    <Num>{num(c.cur_count)}</Num>
                    <Num>{eur(c.cur_net)}</Num>
                    <Num>{eur(c.prev_net)}</Num>
                    <Num>
                      <Variation current={c.cur_net} previous={c.prev_net} />
                    </Num>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <Num>{num((store?.cur_count ?? 0) + (online?.cur_count ?? 0))}</Num>
                  <Num>{eur((store?.cur_net ?? 0) + (online?.cur_net ?? 0))}</Num>
                  <Num>{eur((store?.prev_net ?? 0) + (online?.prev_net ?? 0))}</Num>
                  <Num>
                    <Variation
                      current={(store?.cur_net ?? 0) + (online?.cur_net ?? 0)}
                      previous={(store?.prev_net ?? 0) + (online?.prev_net ?? 0)}
                    />
                  </Num>
                </TableRow>
              </TableBody>
            </Table>
          </Section>

          <Latest r={r} today={period.today} />

          {r.by_month.length > 1 && (
            <Section title="Por mes" description="Cada mes frente al mismo mes del año anterior (en los meses a medias, los mismos días).">
              <PeriodTable
                first="Mes"
                channel={r.channel}
                rows={r.by_month.map((m) => ({ ...m, key: m.month, label: monthName(m.month) }))}
              />
            </Section>
          )}

          <Section
            title="Por forma de pago"
            description="Stockagile solo guarda el nombre del pago: los tickets pagados con efectivo y tarjeta salen juntos y los que no traen dato, en «Sin dato». La web va junta."
          >
            {r.by_payment.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin ventas en ese periodo.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Forma de pago</TableHead>
                    <Head>Tickets</Head>
                    <Head>Ventas</Head>
                    <Head>Neto</Head>
                    <Head>Año anterior</Head>
                    <Head>Variación</Head>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.by_payment.map((p) => (
                    <TableRow key={p.m}>
                      <TableCell className="font-medium">{methodLabel(p.m)}</TableCell>
                      <Num>{num(p.cur_count)}</Num>
                      <Num>{eur(p.cur_sales)}</Num>
                      <Num>{eur(p.cur_net)}</Num>
                      <Num>{eur(p.prev_net)}</Num>
                      <Num>
                        <Variation current={p.cur_net} previous={p.prev_net} />
                      </Num>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          {r.can_see_sellers && r.channel !== 'online' && (
            <Section
              title="Por vendedor (tienda)"
              description="Solo lo ve el propietario. Las devoluciones se restan a quien las hizo. Los tickets de Stockagile no guardan vendedor: van juntos."
            >
              {r.by_seller.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Sin ventas en ese periodo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <Head>Tickets</Head>
                      <Head>Ventas</Head>
                      <Head>Neto</Head>
                      <Head>Año anterior</Head>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.by_seller.map((s) => (
                      <TableRow key={s.seller_key}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <Num>{num(s.cur_count)}</Num>
                        <Num>{eur(s.cur_sales)}</Num>
                        <Num>{eur(s.cur_net)}</Num>
                        <Num>{eur(s.prev_net)}</Num>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          )}

          {r.by_day.length > 1 && (
            <Section
              scroll
              title="Por día"
              description="Cada día se compara con el mismo día del año anterior (misma fecha, no mismo día de la semana)."
            >
              <PeriodTable
                first="Día"
                channel={r.channel}
                rows={r.by_day.map((d) => ({ ...d, key: d.date, label: dayLabel(d.date) }))}
              />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
