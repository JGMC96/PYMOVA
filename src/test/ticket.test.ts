import { describe, it, expect } from 'vitest';
import { renderTicketBody, taxBreakdown } from '@/lib/ticket';

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
