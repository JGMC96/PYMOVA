import { describe, expect, it } from 'vitest';
import { finalPriceDiscount, lineDiscountAmount, lineDiscountPct, parseAmount } from '@/lib/lineDiscount';

describe('descuento de una línea del TPV', () => {
  it('precio final: 165 € que se dejan en 139 € son 26 € de descuento y la línea queda en 139,00', () => {
    const d = finalPriceDiscount(165, '139');
    expect(d).toEqual({ mode: 'price', value: '139' });
    const amount = lineDiscountAmount(165, d);
    expect(amount).toBe(26);
    expect(165 - amount).toBe(139);
    expect(lineDiscountPct(165, amount)).toBe(15.76);
  });

  it('precio final con céntimos y con coma', () => {
    const d = finalPriceDiscount(59.95, '49,90');
    expect(lineDiscountAmount(59.95, d)).toBe(10.05);
    expect(Math.round((59.95 - lineDiscountAmount(59.95, d)) * 100) / 100).toBe(49.9);
  });

  it('precio final igual o mayor que el del catálogo, o vacío: sin descuento', () => {
    expect(finalPriceDiscount(165, '165')).toBeNull();
    expect(finalPriceDiscount(165, '170')).toBeNull();
    expect(finalPriceDiscount(165, '')).toBeNull();
    expect(finalPriceDiscount(165, 'abc')).toBeNull();
    // Gratis: el descuento es todo el bruto.
    expect(lineDiscountAmount(165, finalPriceDiscount(165, '0'))).toBe(165);
  });

  it('en %, como hasta ahora: redondeado al céntimo y como mucho el 100 %', () => {
    expect(lineDiscountAmount(165, { mode: 'pct', value: '15' })).toBe(24.75);
    expect(lineDiscountAmount(165, { mode: 'pct', value: '15,5' })).toBe(25.58);
    expect(lineDiscountAmount(165, { mode: 'pct', value: '150' })).toBe(165);
    expect(lineDiscountAmount(165, { mode: 'pct', value: '-5' })).toBe(0);
  });

  it('en €: nunca más que la línea ni negativo', () => {
    expect(lineDiscountAmount(165, { mode: 'eur', value: '26' })).toBe(26);
    expect(lineDiscountAmount(165, { mode: 'eur', value: '200' })).toBe(165);
    expect(lineDiscountAmount(165, { mode: 'eur', value: '-3' })).toBe(0);
    expect(lineDiscountAmount(0, { mode: 'eur', value: '3' })).toBe(0);
    expect(lineDiscountAmount(165, null)).toBe(0);
  });

  it('lee importes con coma, punto, € o % y espacios', () => {
    expect(parseAmount(' 139,50 € ')).toBe(139.5);
    expect(parseAmount('15%')).toBe(15);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('1,2,3')).toBeNull();
  });
});
