import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, ean13Modules, ean13Svg, isValidEan13 } from '@/lib/ean13';

describe('EAN-13', () => {
  it('calcula y comprueba el dígito de control', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('200000000001')).toBe(5); // 2·1 + 1·3 = 5 → 10 − 5
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('083')).toBe(false);
    expect(isValidEan13(null)).toBe(false);
  });

  it('codifica con las guardas y los juegos L/G/R del estándar', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(m.startsWith('101')).toBe(true);
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.endsWith('101')).toBe(true);
    // Primer dígito 4 → juegos L G L L G G; el segundo dígito (0) va en L: 0001101.
    expect(m.slice(3, 10)).toBe('0001101');
    // El tercero (0) va en G: 0100111.
    expect(m.slice(10, 17)).toBe('0100111');
    // Lado derecho, último dígito (1) en R: 1100110.
    expect(m.slice(85, 92)).toBe('1100110');
  });

  it('pinta el SVG y rechaza códigos no válidos', () => {
    expect(ean13Svg('4006381333931')).toContain('aria-label="Código de barras 4006381333931"');
    expect(() => ean13Svg('123')).toThrow(/no válido/);
  });
});
