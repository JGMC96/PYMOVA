import { describe, expect, it } from 'vitest';
import { currencyLocale, formatMoney } from '@/lib/money';

describe('formatMoney', () => {
  it('escribe euros a la española y pesos a la mexicana', () => {
    expect(formatMoney(145, 'EUR')).toBe('145,00 €');
    expect(formatMoney(1234.5, 'EUR')).toBe('1234,50 €');
    expect(formatMoney(145, 'MXN')).toBe('$145.00');
    expect(formatMoney(145, 'USD')).toBe('$145.00');
  });

  it('por defecto es EUR y aguanta nulos, texto y monedas raras', () => {
    expect(formatMoney(10)).toBe('10,00 €');
    expect(formatMoney(null)).toBe('0,00 €');
    expect(formatMoney(undefined, 'eur')).toBe('0,00 €');
    expect(formatMoney(Number('abc'))).toBe('0,00 €');
    expect(formatMoney(5, 'XXX')).toMatch(/5[.,]00/);
    expect(currencyLocale('EUR')).toBe('es-ES');
    expect(currencyLocale('ZZZ')).toBe('es-ES');
  });
});
