import { describe, expect, it } from 'vitest';
import { buildSaleReceipt, type SaleReceiptSource } from '../../supabase/functions/_shared/sale-receipt.ts';
import { code128Modules, code128Runs } from '../../supabase/functions/_shared/code128.ts';
import { code128Modules as fromLib } from '@/lib/barcode';

const fuente = (over: Partial<SaleReceiptSource> = {}): SaleReceiptSource => ({
  sale: {
    sale_number: 'VTA-000123',
    created_at: '2026-10-20T16:30:00Z',
    payment_method: 'cash',
    subtotal: '161.16',
    tax: '33.84',
    total: '195',
    tip: '0',
    cash_received: '200',
    change_given: '5',
  },
  items: [
    { product_name: 'Zueco Rio Tira Pelo Cow · 38', quantity: '1', unit_price: '175', total: '175' },
    { product_name: 'Calcetines', quantity: 2, unit_price: 10, total: 20 },
  ],
  business: { name: 'Codiarch', trade_name: 'Tuilus', legal_name: 'Codiarch Squad S.L.', tax_id: 'B02768679', currency: 'EUR', timezone: 'Europe/Madrid' },
  settings: {
    tax_rate: 21,
    ticket_trade_name: null,
    ticket_legal_name: null,
    ticket_tax_id: null,
    ticket_address: 'Calle Conde de Altea 1\n46005 Valencia',
    ticket_phone: null,
    ticket_website: 'www.tuilus.com',
    ticket_footer: '  ',
    ticket_return_policy: 'Cambios en 15 días',
  },
  clientName: 'Lucía',
  cashier: 'Ana',
  ...over,
});

const n = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

describe('ticket por correo', () => {
  it('toma los datos del negocio, del ticket y de la venta', () => {
    const r = buildSaleReceipt(fuente());
    expect(r).toMatchObject({
      businessName: 'Tuilus',
      legalName: 'Codiarch Squad S.L.',
      taxId: 'B02768679',
      address: 'Calle Conde de Altea 1\n46005 Valencia',
      saleNumber: 'VTA-000123',
      clientName: 'Lucía',
      cashier: 'Ana',
      taxLabel: 'IVA 21 %',
      payment: 'Efectivo',
      returnPolicy: 'Cambios en 15 días',
      footer: '¡Gracias por su compra!',
      tip: null,
    });
    // 16:30 UTC en octubre = 18:30 en Madrid.
    expect(r.date).toMatch(/20\/10\/2026.*18:30/);
    expect(n(r.total)).toBe('195,00 €');
    expect(n(r.base)).toBe('161,16 €');
    expect(n(r.tax)).toBe('33,84 €');
    expect(n(r.cashReceived)).toBe('200,00 €');
    expect(n(r.change)).toBe('5,00 €');
    expect(r.lines.map((l) => [l.name, n(l.detail), n(l.total), l.discount])).toEqual([
      ['Zueco Rio Tira Pelo Cow · 38', '1 x 175,00 €', '175,00 €', null],
      ['Calcetines', '2 x 10,00 €', '20,00 €', null],
    ]);
  });

  it('suma la propina al total y muestra el descuento de cada línea', () => {
    const r = buildSaleReceipt(fuente({
      sale: { ...fuente().sale, tip: '2', total: '157.5', payment_method: 'store_credit', cash_received: null, change_given: null },
      items: [{ product_name: 'Zueco', quantity: 1, unit_price: 175, total: 157.5 }],
    }));
    expect(n(r.tip)).toBe('2,00 €');
    expect(n(r.total)).toBe('159,50 €');
    expect(n(r.lines[0].discount)).toBe('-17,50 €');
    expect(r.payment).toBe('Vale');
    expect(r.cashReceived).toBeNull();
    expect(r.change).toBeNull();
  });

  it('usa los datos del ticket si están y la moneda del negocio', () => {
    const r = buildSaleReceipt(fuente({
      business: { ...fuente().business, currency: 'MXN' },
      settings: { ...fuente().settings!, ticket_trade_name: 'Tuilus Valencia', tax_rate: '10' },
    }));
    expect(r.businessName).toBe('Tuilus Valencia');
    expect(r.taxLabel).toBe('IVA 10 %');
    expect(r.total).toContain('MXN');
  });

  it('pinta el mismo código de barras que el ticket impreso', () => {
    const r = buildSaleReceipt(fuente());
    const modules = r.barcode.map((x) => (x.bar ? '1' : '0').repeat(x.width)).join('');
    expect(modules).toBe(code128Modules('VTA-000123'));
    expect(fromLib('VTA-000123')).toBe(modules);
    expect(r.barcode[0].bar).toBe(true);
    expect(code128Runs('A').every((x, i, a) => i === 0 || x.bar !== a[i - 1].bar)).toBe(true);
  });
});
