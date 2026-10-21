import { describe, expect, it } from 'vitest';
import { parseVarios, variosCartItem } from '@/lib/varios';

describe('Varios en el TPV', () => {
  it('acepta descripción, precio con coma y unidades', () => {
    expect(parseVarios({ name: '  Bolso outlet ', price: '19,90', quantity: '2' }))
      .toEqual({ ok: true, name: 'Bolso outlet', price: 19.9, quantity: 2 });
    expect(parseVarios({ name: 'Cinturón', price: '5', quantity: '' }))
      .toEqual({ ok: true, name: 'Cinturón', price: 5, quantity: 1 });
    // Si alguien escribe el prefijo, no se duplica.
    expect(parseVarios({ name: 'Varios · Gorro', price: '8', quantity: '1' })).toMatchObject({ ok: true, name: 'Gorro' });
  });

  it('rechaza lo que la venta no aceptaría', () => {
    expect(parseVarios({ name: '  ', price: '10', quantity: '1' })).toEqual({ ok: false, error: 'Escribe qué se vende' });
    expect(parseVarios({ name: 'Bolso', price: '0', quantity: '1' }).ok).toBe(false);
    expect(parseVarios({ name: 'Bolso', price: '-3', quantity: '1' }).ok).toBe(false);
    expect(parseVarios({ name: 'Bolso', price: 'abc', quantity: '1' }).ok).toBe(false);
    expect(parseVarios({ name: 'Bolso', price: '100000', quantity: '1' }).ok).toBe(false);
    expect(parseVarios({ name: 'Bolso', price: '10', quantity: '1,5' }).ok).toBe(false);
    expect(parseVarios({ name: 'Bolso', price: '10', quantity: '0' }).ok).toBe(false);
    expect(parseVarios({ name: 'x'.repeat(121), price: '10', quantity: '1' }).ok).toBe(false);
  });

  it('crea una línea libre con clave propia, sin variante y marcada como Varios', () => {
    expect(variosCartItem({ name: 'Bolso outlet', price: 19.9, quantity: 2 }, 'abc')).toEqual({
      product_id: 'varios:abc',
      variant_id: null,
      custom: true,
      product_name: 'Varios · Bolso outlet',
      quantity: 2,
      unit_price: 19.9,
      total: 39.8,
    });
    const a = variosCartItem({ name: 'Bolso', price: 10, quantity: 1 });
    const b = variosCartItem({ name: 'Bolso', price: 10, quantity: 1 });
    expect(a.product_id).not.toBe(b.product_id);
  });
});
