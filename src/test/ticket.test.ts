import { describe, it, expect } from 'vitest';
import { renderTicketBody, taxBreakdown, type TicketLine } from '@/lib/ticket';

describe('ticket tax breakdown (IVA incluido)', () => {
  it('121 € al 21% → base 100 €, IVA 21 €', () => {
    expect(taxBreakdown(121, 21)).toEqual({ base: 100, tax: 21 });
  });
  it('179 € al 21% → base 147,93 €, IVA 31,07 €', () => {
    expect(taxBreakdown(179, 21)).toEqual({ base: 147.93, tax: 31.07 });
  });
});

describe('ticket con código de barras', () => {
  it('lleva el Code 128 del número y el número legible', () => {
    const html = renderTicketBody(
      { name: 'TUILUS' },
      { kind: 'sale', number: 'VTA-000123', createdAt: new Date('2026-10-20T10:00:00Z'), lines: [], taxRate: 21, total: 6 },
    );
    expect(html).toContain('<div class="barcode"><svg');
    expect(html).toContain('aria-label="Código de barras VTA-000123"');
    expect(html).toContain('<div class="center ref">VTA-000123</div>');
    expect(html).not.toContain('*VTA-000123*');
  });
});

describe('ticket de abono', () => {
  it('dice qué venta rectifica, en negativo, con el reembolso y el código DEV', () => {
    const html = renderTicketBody(
      { name: 'TUILUS' },
      {
        kind: 'refund',
        number: 'DEV-000004',
        originalNumber: 'VTA-000012',
        createdAt: new Date('2026-10-20T10:00:00Z'),
        lines: [{ name: 'Zueco Rio Tira · 38', quantity: 1, unitPrice: 155, total: 155 }],
        taxRate: 21,
        total: 155,
        paymentMethod: 'store_credit',
        cashier: 'Ana',
      },
    );
    expect(html).toContain('TICKET DE ABONO');
    expect(html).toContain('<span>Rectifica</span><span>VTA-000012</span>');
    expect(html).toContain('-155,00');
    expect(html).toContain('<span>Reembolso</span><span>Vale</span>');
    expect(html).toContain('<span>Atendido por</span><span>Ana</span>');
    expect(html).toContain('aria-label="Código de barras DEV-000004"');
  });
});

describe('vales de tienda en el ticket', () => {
  const base = { createdAt: new Date('2026-10-22T10:00:00Z'), lines: [] as TicketLine[], taxRate: 21 };

  it('el abono con vale lleva el código con su código de barras, el importe y la caducidad', () => {
    const html = renderTicketBody(
      { name: 'TUILUS' },
      {
        ...base, kind: 'refund', number: 'DEV-000007', total: 89, paymentMethod: 'store_credit',
        voucherIssued: { code: 'VALE-ABCD2345', amount: 89, expiresAt: new Date('2027-10-22T10:00:00Z') },
      },
    );
    expect(html).toContain('VALE DE TIENDA');
    expect(html).toContain('aria-label="Código de barras VALE-ABCD2345"');
    expect(html).toContain('<div class="center ref">VALE-ABCD2345</div>');
    expect(html).toContain('89,00 €');
    expect(html).toContain('22/10/2027');
    expect(html).toContain('Canjeable solo en tienda');
  });

  it('la venta pagada en parte con vale muestra el vale, el saldo que queda y el resto', () => {
    const html = renderTicketBody(
      { name: 'TUILUS' },
      {
        ...base, kind: 'sale', number: 'VTA-000200', total: 100, paymentMethod: 'cash',
        voucherPaid: { code: 'VALE-ABCD2345', amount: 60, balanceLeft: 29 },
      },
    );
    expect(html).toMatch(/Vale VALE-ABCD2345<\/span><span>60,00 €/);
    expect(html).toMatch(/Saldo que queda<\/span><span>29,00 €/);
    expect(html).toMatch(/Pago<\/span><span>Efectivo/);
  });

  it('pagada entera con vale no repite «Pago: Vale»', () => {
    const html = renderTicketBody(
      { name: 'TUILUS' },
      { ...base, kind: 'sale', number: 'VTA-000201', total: 40, paymentMethod: 'store_credit', voucherPaid: { code: 'VALE-ABCD2345', amount: 40, balanceLeft: 0 } },
    );
    expect(html).toContain('Vale VALE-ABCD2345');
    expect(html).not.toMatch(/Pago<\/span>/);
  });
});
