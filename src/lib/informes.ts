// Lógica pura de los informes (apartado «Informes», solo propietario): tipos de lo que devuelve
// la RPC, variaciones, etiquetas y CSV. Los cálculos de dinero se hacen en el servidor.
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
  src: 'pymova' | 'stockagile';
  sales_count: number;
  sales_total: number;
  net_total: number;
}

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

/** Nombre de cada forma de pago: las de PYMOVA y las que deduce el informe de Stockagile. */
export const METHOD_LABELS: Record<string, string> = {
  ...PAYMENT_LABELS,
  cash_card: 'Efectivo y tarjeta (sin desglose)',
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

/** Resumen, formas de pago, vendedores y días en un solo CSV (cada bloque con su título). */
export function salesReportCsv(r: SalesReport): string {
  const n = (v: number) => round2(v);
  const pct = (cur: number, prev: number) => {
    const v = variation(cur, prev);
    return v === null ? '' : round2(v);
  };
  const lines: string[] = [];
  lines.push(csvRow(['Informe de ventas', `${r.period.from} a ${r.period.to}`]));
  lines.push(csvRow(['Comparado con', `${r.previous.from} a ${r.previous.to}`]));
  lines.push('');
  lines.push(csvRow(['Resumen', 'Periodo', 'Año anterior', 'Variación %']));
  const resumen: [string, number, number][] = [
    ['Tickets de venta', r.current.sales_count, r.prior.sales_count],
    ['Ventas', r.current.sales_total, r.prior.sales_total],
    ['Devoluciones (importe)', r.current.returns_total, r.prior.returns_total],
    ['Devoluciones (tickets)', r.current.returns_count, r.prior.returns_count],
    ['Cambios con diferencia (importe)', r.current.exchanges_total, r.prior.exchanges_total],
    ['Neto', r.current.net_total, r.prior.net_total],
    ['Ticket medio', averageTicket(r.current), averageTicket(r.prior)],
  ];
  for (const [label, cur, prev] of resumen) lines.push(csvRow([label, n(cur), n(prev), pct(cur, prev)]));
  lines.push('');
  lines.push(csvRow(['Forma de pago', 'Tickets', 'Ventas', 'Neto', 'Neto año anterior', 'Variación %']));
  for (const p of r.by_payment) {
    lines.push(csvRow([methodLabel(p.m), p.cur_count, n(p.cur_sales), n(p.cur_net), n(p.prev_net), pct(p.cur_net, p.prev_net)]));
  }
  lines.push('');
  lines.push(csvRow(['Vendedor', 'Tickets', 'Ventas', 'Neto', 'Neto año anterior', 'Variación %']));
  for (const s of r.by_seller) {
    lines.push(csvRow([s.name, s.cur_count, n(s.cur_sales), n(s.cur_net), n(s.prev_net), pct(s.cur_net, s.prev_net)]));
  }
  lines.push('');
  lines.push(csvRow(['Día', 'Tickets', 'Neto', 'Tickets año anterior', 'Neto año anterior']));
  for (const d of r.by_day) {
    lines.push(csvRow([d.date, d.cur_count, n(d.cur_net), d.prev_count, n(d.prev_net)]));
  }
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
