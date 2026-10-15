import { describe, it, expect } from 'vitest';
import { taxBreakdown } from '@/lib/ticket';

describe('ticket tax breakdown (IVA incluido)', () => {
  it('121 € al 21% → base 100 €, IVA 21 €', () => {
    expect(taxBreakdown(121, 21)).toEqual({ base: 100, tax: 21 });
  });
  it('179 € al 21% → base 147,93 €, IVA 31,07 €', () => {
    expect(taxBreakdown(179, 21)).toEqual({ base: 147.93, tax: 31.07 });
  });
});
