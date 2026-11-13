import { describe, expect, it } from 'vitest';
import { posLineTaxes } from '../../supabase/functions/_shared/shopify-core';

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('posLineTaxes', () => {
  it('saca el IVA incluido de una línea (124 € → 21,52 €, como el pedido web)', () => {
    expect(posLineTaxes([124], 21, 21.52)).toEqual([21.52]);
  });

  it('reparte el IVA entre varias líneas y suma exactamente el de la venta', () => {
    // VTA-000057: 492 € en tres líneas; en PYMOVA, 85,39 € de IVA.
    const taxes = posLineTaxes([164, 164, 164], 21, 85.39);
    expect(sum(taxes)).toBe(85.39);
    expect(taxes.every((t) => t > 28 && t < 29)).toBe(true);
  });

  it('el céntimo de redondeo va a la línea más grande', () => {
    // 10 + 10 + 10: 1,74 por línea (5,22), pero sobre 30 € el IVA es 5,21.
    expect(posLineTaxes([10, 10, 10], 21, 5.21)).toEqual([1.73, 1.74, 1.74]);
    expect(posLineTaxes([4.8, 100], 21, 18.19)).toEqual([0.83, 17.36]);
  });

  it('una línea con descuento lleva el IVA de lo que se cobra, no del precio de catálogo', () => {
    // Precio 149 € con 20 % de descuento: la línea vale 119,20 €.
    expect(posLineTaxes([119.2], 21, 20.69)).toEqual([20.69]);
  });

  it('sin el IVA de la venta, lo calcula sobre el total', () => {
    expect(posLineTaxes([10, 10, 10], 21, null)).toEqual([1.73, 1.74, 1.74]);
  });

  it('las líneas a 0 € no llevan IVA', () => {
    expect(posLineTaxes([0], 21, 0)).toEqual([0]);
    expect(posLineTaxes([0, 50], 21, 8.68)).toEqual([0, 8.68]);
  });

  it('sin tipo de IVA, nada', () => {
    expect(posLineTaxes([124], 0, 0)).toEqual([0]);
  });

  it('si el IVA de la venta no cuadra con las líneas, se queda el cálculo de cada línea', () => {
    expect(posLineTaxes([124], 21, 50)).toEqual([21.52]);
  });
});
