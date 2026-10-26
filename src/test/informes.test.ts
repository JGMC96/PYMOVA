import { describe, expect, it } from 'vitest';
import { averageTicket, methodLabel, salesReportCsv, variation, type SalesReport } from '@/lib/informes';

const kpis = (o: Partial<SalesReport['current']> = {}) => ({
  sales_count: 0, sales_total: 0, returns_count: 0, returns_total: 0, exchanges_count: 0, exchanges_total: 0, net_total: 0, ...o,
});

const informe = (o: Partial<SalesReport> = {}): SalesReport => ({
  period: { from: '2026-10-01', to: '2026-10-31' },
  previous: { from: '2025-10-01', to: '2025-10-31' },
  current: kpis({ sales_count: 4, sales_total: 300, returns_count: 1, returns_total: 50, net_total: 250 }),
  prior: kpis({ sales_count: 2, sales_total: 100, net_total: 100 }),
  by_source: [],
  by_payment: [],
  by_seller: [],
  by_day: [],
  ...o,
});

describe('informes · variación y ticket medio', () => {
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

  it('las formas de pago de Stockagile tienen nombre', () => {
    expect(methodLabel('cash')).toBe('Efectivo');
    expect(methodLabel('cash_card')).toContain('sin desglose');
    expect(methodLabel('none')).toBe('Sin dato');
    expect(methodLabel('rara')).toBe('rara');
  });
});

describe('informes · CSV de ventas', () => {
  it('lleva resumen, pago, vendedor y día, y neutraliza las celdas que parecen fórmulas', () => {
    const csv = salesReportCsv(
      informe({
        by_payment: [{ m: 'card', cur_count: 3, cur_sales: 190, cur_net: 205, prev_count: 1, prev_sales: 200, prev_net: 200 }],
        by_seller: [{ seller_key: 'x', name: '=HYPERLINK("http://x")', cur_count: 1, cur_sales: 10, cur_net: 10, prev_count: 0, prev_sales: 0, prev_net: 0 }],
        by_day: [{ date: '2026-10-10', cur_count: 3, cur_net: 230, prev_count: 1, prev_net: 200 }],
      }),
    );
    const lineas = csv.split('\r\n');
    expect(lineas[0]).toBe('"Informe de ventas","2026-10-01 a 2026-10-31"');
    expect(csv).toContain('"Neto",250,100,150');
    expect(csv).toContain('"Ticket medio",62.5,50,25');
    expect(csv).toContain('"Tarjeta",3,190,205,200,2.5');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",1,10,10,0,`);
    expect(csv).toContain('"2026-10-10",3,230,1,200');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('sin año anterior deja la variación vacía', () => {
    const csv = salesReportCsv(informe({ prior: kpis() }));
    expect(csv).toContain('"Neto",250,0,""');
  });
});
