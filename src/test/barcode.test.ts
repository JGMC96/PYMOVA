import { describe, expect, it } from 'vitest';
import { code128Modules, code128Svg, code128Values } from '@/lib/barcode';
import { normalizeTicketCode } from '@/lib/ticketCode';

const START_B = '11010010000';
const STOP = '1100011101011';

describe('Code 128', () => {
  it('codifica texto en el juego B con su checksum', () => {
    // «AB»: inicio B (104), A=33, B=34 → checksum (104 + 33·1 + 34·2) % 103 = 102
    expect(code128Values('AB')).toEqual([104, 33, 34, 102, 106]);
    const m = code128Modules('A');
    expect(m.startsWith(START_B)).toBe(true);
    expect(m.endsWith(STOP)).toBe(true);
    expect(m.slice(11, 22)).toBe('10100011000'); // patrón estándar de «A»
  });

  it('pasa a juego C los dígitos finales en número par', () => {
    // VTA-000123: V,T,A,- en B; luego CODE C (99) y 00,01,23
    const v = code128Values('VTA-000123');
    expect(v.slice(0, 6)).toEqual([104, 54, 52, 33, 13, 99]);
    expect(v.slice(6, 9)).toEqual([0, 1, 23]);
    const checksum = [104, 54, 52, 33, 13, 99, 0, 1, 23].reduce((s, x, i) => s + x * (i === 0 ? 1 : i), 0) % 103;
    expect(v[9]).toBe(checksum);
    expect(v[10]).toBe(106);
    // 11 módulos por símbolo y 13 del de parada.
    expect(code128Modules('VTA-000123').length).toBe(10 * 11 + 13);
  });

  it('con dígitos impares deja el primero en B', () => {
    expect(code128Values('X12345').slice(0, 4)).toEqual([104, 56, 17, 99]);
  });

  it('el SVG tiene zona en blanco y barras', () => {
    const svg = code128Svg('VTA-000001');
    expect(svg).toContain('viewBox="0 0 143 1"');
    expect(svg).toContain('<rect x="10"');
    expect(() => code128Svg('Ñ')).toThrow();
  });
});

describe('normalizeTicketCode', () => {
  it('acepta lo que escriben los lectores', () => {
    expect(normalizeTicketCode('VTA-000123')).toBe('VTA-000123');
    expect(normalizeTicketCode("vta'000123")).toBe('VTA-000123');
    expect(normalizeTicketCode('VTA000123')).toBe('VTA-000123');
    expect(normalizeTicketCode(' 123 ')).toBe('VTA-000123');
    expect(normalizeTicketCode('DEV-000002')).toBe('DEV-000002');
    expect(normalizeTicketCode('VTA-000000')).toBe('VTA-000000');
  });

  it('rechaza lo que no es un número de ticket', () => {
    expect(normalizeTicketCode('')).toBeNull();
    expect(normalizeTicketCode('zueco')).toBeNull();
    expect(normalizeTicketCode('VTA-12A')).toBeNull();
  });
});
