// Lógica pura de los informes (apartado «Informes»: propietario y quien tenga «Ver ventas»):
// tipos de lo que devuelven las RPC, variaciones, etiquetas y CSV. Los cálculos de dinero se hacen en el servidor.
import { csvRow } from '@/lib/csv';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';

/** Pantallas del apartado Informes (cada PR añade la suya). */
export const INFORME_TABS = [{ path: 'ventas', label: 'Ventas' }] as const;

export interface SalesKpis {
  sales_count: number;
  sales_total: number;
  returns_count: number;
  returns_total: number;
  exchanges_count: number;
  exchanges_total: number;
  net_total: number;
}

export interface SalesCompareRow {
  cur_count: number;
  cur_sales: number;
  cur_net: number;
  prev_count: number;
  prev_sales: number;
  prev_net: number;
}

export interface PaymentRow extends SalesCompareRow {
  m: string;
}

export interface SellerRow extends SalesCompareRow {
  seller_key: string;
  name: string;
}

export interface DayRow {
  date: string;
  cur_count: number;
  cur_net: number;
  prev_count: number;
  prev_net: number;
}

export interface SourceRow {
  per: 'cur' | 'prev';
  src: 'pymova' | 'stockagile' | 'shopify';
  sales_count: number;
  sales_total: number;
  net_total: number;
}

/** Informe de la 0055 (solo tienda). La pantalla usa ya el de la 0064. */
export interface SalesReport {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  current: SalesKpis;
  prior: SalesKpis;
  by_source: SourceRow[];
  by_payment: PaymentRow[];
  by_seller: SellerRow[];
  by_day: DayRow[];
}

export type Channel = 'store' | 'online';
export type SalesChannel = 'all' | Channel;

export const CHANNEL_LABEL: Record<SalesChannel, string> = { all: 'Todo', store: 'Tienda', online: 'Online' };

export interface LiveKpis extends SalesKpis {
  /** Pedidos web devueltos enteros (suman 0 y no cuentan como ticket). */
  online_returned_count: number;
  /** Envío incluido en el importe online. */
  shipping_total: number;
}

export interface ChannelRow {
  channel: Channel;
  cur_count: number;
  cur_net: number;
  cur_shipping: number;
  cur_returned: number;
  prev_count: number;
  prev_net: number;
}

/** Cifras netas de un mes o de un día, por canal, con las del año anterior. */
export interface PeriodRow {
  cur_count: number;
  cur_store: number;
  cur_online: number;
  prev_count: number;
  prev_store: number;
  prev_online: number;
}

export interface MonthRow extends PeriodRow {
  /** AAAA-MM */
  month: string;
}

export interface LiveDayRow extends PeriodRow {
  date: string;
}

export interface LatestSale {
  at: string;
  channel: Channel;
  amount: number;
}

export interface LiveSalesReport {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  /** En «Hoy», hora hasta la que cuenta el año anterior (HH:MM). */
  prior_until: string | null;
  channel: SalesChannel;
  can_see_sellers: boolean;
  generated_at: string;
  current: LiveKpis;
  prior: LiveKpis;
  by_channel: ChannelRow[];
  by_source: SourceRow[];
  by_payment: PaymentRow[];
  by_seller: SellerRow[];
  by_month: MonthRow[];
  /** Vacío en periodos de más de 93 días. */
  by_day: LiveDayRow[];
  latest: LatestSale[];
}

/** Nombre de cada forma de pago: las de PYMOVA y las que deduce el informe de Stockagile. */
export const METHOD_LABELS: Record<string, string> = {
  ...PAYMENT_LABELS,
  cash_card: 'Efectivo y tarjeta (sin desglose)',
  web: 'Web (Shopify)',
  none: 'Sin dato',
  other: 'Otros',
};

export const methodLabel = (m: string) => METHOD_LABELS[m] ?? m;

/** Neto entre tickets de venta (0 si no hubo ventas). */
export const averageTicket = (k: Pick<SalesKpis, 'net_total' | 'sales_count'>) =>
  k.sales_count > 0 ? k.net_total / k.sales_count : 0;

/** Variación en % respecto al año anterior; null si no hay base con la que comparar. */
export function variation(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** «2026-10» → «octubre 2026». */
export function monthName(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `${MESES[m - 1] ?? month} ${y}`;
}

/** Total de una fila de mes o de día (tienda más online). */
export const rowTotals = (r: PeriodRow) => ({ cur: r.cur_store + r.cur_online, prev: r.prev_store + r.prev_online });

/** Resumen, canales, formas de pago, vendedores, meses y días en un solo CSV (cada bloque con su título). */
export function salesReportCsv(r: LiveSalesReport): string {
  const n = (v: number) => round2(v);
  const pct = (cur: number, prev: number) => {
    const v = variation(cur, prev);
    return v === null ? '' : round2(v);
  };
  const lines: string[] = [];
  const bloque = (cabecera: string[], filas: unknown[][]) => {
    lines.push('');
    lines.push(csvRow(cabecera));
    for (const f of filas) lines.push(csvRow(f));
  };
  const hasta = r.prior_until ? ` (hasta las ${r.prior_until})` : '';
  lines.push(csvRow(['Informe de ventas', `${r.period.from} a ${r.period.to}`]));
  lines.push(csvRow(['Comparado con', `${r.previous.from} a ${r.previous.to}${hasta}`]));
  lines.push(csvRow(['Canal', CHANNEL_LABEL[r.channel]]));

  const resumen: [string, number, number][] = [
    ['Tickets de venta', r.current.sales_count, r.prior.sales_count],
    ['Ventas', r.current.sales_total, r.prior.sales_total],
    ['Devoluciones de tienda (importe)', r.current.returns_total, r.prior.returns_total],
    ['Devoluciones de tienda (tickets)', r.current.returns_count, r.prior.returns_count],
    ['Cambios con diferencia (importe)', r.current.exchanges_total, r.prior.exchanges_total],
    ['Pedidos web devueltos', r.current.online_returned_count, r.prior.online_returned_count],
    ['Envío incluido en online', r.current.shipping_total, r.prior.shipping_total],
    ['Neto', r.current.net_total, r.prior.net_total],
    ['Ticket medio', averageTicket(r.current), averageTicket(r.prior)],
  ];
  bloque(
    ['Resumen', 'Periodo', 'Año anterior', 'Variación %'],
    resumen.map(([label, cur, prev]) => [label, n(cur), n(prev), pct(cur, prev)]),
  );
  bloque(
    ['Tienda y online', 'Tickets', 'Neto', 'Neto año anterior', 'Variación %'],
    r.by_channel.map((c) => [CHANNEL_LABEL[c.channel], c.cur_count, n(c.cur_net), n(c.prev_net), pct(c.cur_net, c.prev_net)]),
  );
  bloque(
    ['Forma de pago', 'Tickets', 'Ventas', 'Neto', 'Neto año anterior', 'Variación %'],
    r.by_payment.map((p) => [methodLabel(p.m), p.cur_count, n(p.cur_sales), n(p.cur_net), n(p.prev_net), pct(p.cur_net, p.prev_net)]),
  );
  if (r.can_see_sellers && r.channel !== 'online') {
    bloque(
      ['Vendedor (tienda)', 'Tickets', 'Ventas', 'Neto', 'Neto año anterior', 'Variación %'],
      r.by_seller.map((s) => [s.name, s.cur_count, n(s.cur_sales), n(s.cur_net), n(s.prev_net), pct(s.cur_net, s.prev_net)]),
    );
  }
  const cabecera = ['Tickets', 'Tienda', 'Online', 'Total', 'Tickets año anterior', 'Total año anterior'];
  const fila = (etiqueta: string, p: PeriodRow) => {
    const t = rowTotals(p);
    return [etiqueta, p.cur_count, n(p.cur_store), n(p.cur_online), n(t.cur), p.prev_count, n(t.prev)];
  };
  bloque(['Mes', ...cabecera], r.by_month.map((m) => fila(m.month, m)));
  if (r.by_day.length) bloque(['Día', ...cabecera], r.by_day.map((d) => fila(d.date, d)));
  return lines.join('\r\n');
}

/** Descarga un CSV (con BOM para que Excel respete los acentos). */
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
