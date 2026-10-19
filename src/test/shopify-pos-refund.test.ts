import { describe, expect, it } from 'vitest';
import { refundAmountForReturn } from '../../supabase/functions/_shared/shopify-core';

describe('refundAmountForReturn', () => {
  it('suma las líneas devueltas', () => {
    expect(refundAmountForReturn([{ quantity: 2, unit_price: 10 }, { quantity: 1, unit_price: 5.5 }], 100, 0)).toBe(25.5);
  });

  it('nunca supera el total de la venta', () => {
    expect(refundAmountForReturn([{ quantity: 3, unit_price: 50 }], 100, 0)).toBe(100);
  });

  it('descuenta lo ya reembolsado de esa venta', () => {
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 80 }], 100, 40)).toBe(60);
  });

  it('devuelve 0 sin líneas o cuando no queda nada por reembolsar', () => {
    expect(refundAmountForReturn([], 100, 0)).toBe(0);
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 10 }], 100, 100)).toBe(0);
  });

  it('redondea a céntimos', () => {
    expect(refundAmountForReturn([{ quantity: 3, unit_price: 33.333 }], 500, 0)).toBe(100);
  });
});
