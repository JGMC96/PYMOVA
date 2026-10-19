import { describe, expect, it } from 'vitest';
import { DEFAULT_TAX_RATE, saleTotals, taxBreakdown } from '@/lib/tax';

describe('IVA incluido', () => {
  it('el tipo por defecto es el 21 %', () => {
    expect(DEFAULT_TAX_RATE).toBe(21);
  });

  it('taxBreakdown deduce base y cuota de un total con IVA', () => {
    expect(taxBreakdown(6, 21)).toEqual({ base: 4.96, tax: 1.04 });
    expect(taxBreakdown(121, 21)).toEqual({ base: 100, tax: 21 });
    expect(taxBreakdown(179, 21)).toEqual({ base: 147.93, tax: 31.07 });
    expect(taxBreakdown(0, 21)).toEqual({ base: 0, tax: 0 });
  });

  it('saleTotals suma las líneas netas y desglosa', () => {
    expect(saleTotals([6, 6, 6], 21)).toEqual({ total: 18, base: 14.88, tax: 3.12 });
    // 99 € con un 10 % de descuento en la línea
    expect(saleTotals([89.1], 21)).toEqual({ total: 89.1, base: 73.64, tax: 15.46 });
    expect(saleTotals([], 21)).toEqual({ total: 0, base: 0, tax: 0 });
  });

  it('base + cuota siempre cuadra con el total', () => {
    for (const total of [0.01, 0.5, 6, 7.26, 19.99, 89.1, 1234.56]) {
      const { base, tax } = taxBreakdown(total, 21);
      expect(Math.round((base + tax) * 100) / 100).toBe(total);
    }
  });
});
