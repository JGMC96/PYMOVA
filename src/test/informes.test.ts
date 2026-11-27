import { describe, expect, it } from 'vitest';
import {
  averageTicket, methodLabel, monthName, rowTotals, salesReportCsv, variation,
  type LiveKpis, type LiveSalesReport,
} from '@/lib/informes';

const kpis = (o: Partial<LiveKpis> = {}): LiveKpis => ({
  sales_count: 0, sales_total: 0, returns_count: 0, returns_total: 0, exchanges_count: 0, exchanges_total: 0, net_total: 0,
  online_returned_count: 0, shipping_total: 0, ...o,
});

const informe = (o: Partial<LiveSalesReport> = {}): LiveSalesReport => ({
  period: { from: '2026-10-01', to: '2026-10-31' },
  previous: { from: '2025-10-01', to: '2025-10-31' },
  prior_until: null,
  channel: 'all',
  can_see_sellers: true,
  generated_at: '2026-10-31T10:00:00Z',
  current: kpis({ sales_count: 4, sales_total: 300, returns_count: 1, returns_total: 50, net_total: 250, shipping_total: 5 }),
  prior: kpis({ sales_count: 2, sales_total: 100, net_total: 100 }),
  by_channel: [],
  by_source: [],
  by_payment: [],
  by_seller: [],
  by_month: [],
  by_day: [],
  latest: [],
  ...o,
});

const vendedor = {
  seller_key: 'x', name: '=HYPERLINK("http://x")', cur_count: 1, cur_sales: 10, cur_net: 10, prev_count: 0, prev_sales: 0, prev_net: 0,
};
const octubre = { cur_count: 3, cur_store: 130, cur_online: 100, prev_count: 1, prev_store: 150, prev_online: 50 };

describe('informes · variación, ticket medio y etiquetas', () => {
  it('la variación es un porcentaje y no existe sin base de comparación', () => {
    expect(variation(150, 100)).toBe(50);
    expect(variation(50, 100)).toBe(-50);
    expect(variation(10, 0)).toBeNull();
    expect(variation(-50, -100)).toBe(50);
  });

  it('el ticket medio es el neto entre los tickets de venta', () => {
    expect(averageTicket({ net_total: 250, sales_count: 4 })).toBe(62.5);
    expect(averageTicket({ net_total: 0, sales_count: 0 })).toBe(0);
  });

  it('las formas de pago de Stockagile y la web tienen nombre', () => {
    expect(methodLabel('cash')).toBe('Efectivo');
    expect(methodLabel('cash_card')).toContain('sin desglose');
    expect(methodLabel('web')).toBe('Web (Shopify)');
    expect(methodLabel('none')).toBe('Sin dato');
    expect(methodLabel('rara')).toBe('rara');
  });

  it('los meses se leen en español y el total suma tienda y online', () => {
    expect(monthName('2026-01')).toBe('enero 2026');
    expect(monthName('2025-12')).toBe('diciembre 2025');
    expect(rowTotals(octubre)).toEqual({ cur: 230, prev: 200 });
  });
});

describe('informes · CSV de ventas', () => {
  it('lleva resumen, canales, pago, vendedor, mes y día, y neutraliza las celdas que parecen fórmulas', () => {
    const csv = salesReportCsv(
      informe({
        by_channel: [
          { channel: 'online', cur_count: 2, cur_net: 100, cur_shipping: 5, cur_returned: 0, prev_count: 1, prev_net: 50 },
        ],
        by_payment: [{ m: 'card', cur_count: 3, cur_sales: 190, cur_net: 205, prev_count: 1, prev_sales: 200, prev_net: 200 }],
        by_seller: [vendedor],
        by_month: [{ month: '2026-10', ...octubre }],
        by_day: [{ date: '2026-10-10', ...octubre }],
      }),
    );
    const lineas = csv.split('\r\n');
    expect(lineas[0]).toBe('"Informe de ventas","2026-10-01 a 2026-10-31"');
    expect(lineas[2]).toBe('"Canal","Todo"');
    expect(csv).toContain('"Neto",250,100,150');
    expect(csv).toContain('"Ticket medio",62.5,50,25');
    expect(csv).toContain('"Envío incluido en online",5,0,""');
    expect(csv).toContain('"Online",2,100,50,100');
    expect(csv).toContain('"Tarjeta",3,190,205,200,2.5');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",1,10,10,0,`);
    expect(csv).toContain('"2026-10",3,130,100,230,1,200');
    expect(csv).toContain('"2026-10-10",3,130,100,230,1,200');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('quien no es propietario no lleva vendedores, y sin días no hay bloque de días', () => {
    const csv = salesReportCsv(informe({ can_see_sellers: false, by_seller: [vendedor] }));
    expect(csv).not.toContain('Vendedor');
    expect(csv).not.toContain('"Día"');
  });

  it('en «Hoy» dice hasta qué hora compara, y sin año anterior deja la variación vacía', () => {
    const csv = salesReportCsv(informe({ prior_until: '12:34', prior: kpis() }));
    expect(csv).toContain('(hasta las 12:34)');
    expect(csv).toContain('"Neto",250,0,""');
  });
});
