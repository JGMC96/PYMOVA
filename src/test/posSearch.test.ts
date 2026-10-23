import { describe, expect, it } from 'vitest';
import { findByCode, searchPosProducts } from '@/lib/posSearch';

const talla = (name: string, sku: string | null, barcode: string | null, stock = 1) => ({
  name,
  sku,
  barcode,
  attributes: { Talla: name },
  stock_quantity: stock,
});

const denia = {
  name: 'Zueco Denia Pala Pelo Menta',
  category: 'Zuecos Verano',
  sku: 'TSSD25ZU001',
  barcode: null,
  color: 'Menta',
  variants: [
    talla('37', 'TSSD25ZU001-37', '8435000000376'),
    talla('38', 'TSSD25ZU001-38', '8435000000383'),
    talla('39', 'TSSD25ZU001-39', '8435000000390', 0),
  ],
};
const paris = {
  name: 'Sandalia París Crema',
  category: 'Verano',
  sku: null,
  barcode: '8435000009999',
  color: null,
  variants: [talla('36', null, null), talla('38', null, null)],
};
const bolso = {
  name: 'Bolso Zueco Charol',
  category: 'Complementos',
  sku: 'BOL-1',
  barcode: '8435000001111',
  variants: [],
};
const products = [bolso, paris, denia];

describe('buscador del TPV', () => {
  it('sin búsqueda devuelve todo, en el mismo orden', () => {
    expect(searchPosProducts(products, '  ').map((h) => h.product)).toEqual(products);
  });

  it('busca en el nombre, la categoría, el SKU, el código y el color del producto', () => {
    expect(searchPosProducts(products, 'paris').map((h) => h.product)).toEqual([paris]);
    expect(searchPosProducts(products, 'zuecos verano').map((h) => h.product)).toEqual([denia]);
    expect(searchPosProducts(products, 'tssd25').map((h) => h.product)).toEqual([denia]);
    expect(searchPosProducts(products, '84350000099').map((h) => h.product)).toEqual([paris]);
    expect(searchPosProducts(products, 'menta').map((h) => h.product)).toEqual([denia]);
  });

  it('encuentra la talla escrita junto al nombre', () => {
    const [hit, ...rest] = searchPosProducts(products, 'zueco denia 38');
    expect(rest).toHaveLength(0);
    expect(hit.product).toBe(denia);
    expect(hit.variant?.name).toBe('38');
    expect(hit.exactCode).toBe(false);
  });

  it('elige la talla por su nombre aunque el número esté en el SKU de otras', () => {
    const hit = searchPosProducts([denia], 'denia 37')[0];
    expect(hit.variant?.name).toBe('37');
  });

  it('sin talla concreta no elige ninguna', () => {
    expect(searchPosProducts(products, 'zueco denia')[0].variant).toBeNull();
    expect(searchPosProducts([denia], 'denia 3')[0].variant).toBeNull();
  });

  it('una palabra que no está ni en el producto ni en sus tallas lo descarta', () => {
    expect(searchPosProducts(products, 'denia 44')).toHaveLength(0);
    expect(searchPosProducts(products, 'sandalia negro')).toHaveLength(0);
  });

  it('el código exacto de una talla va primero y la señala', () => {
    const hits = searchPosProducts(products, 'tssd25zu001-39');
    expect(hits[0]).toMatchObject({ product: denia, exactCode: true });
    expect(hits[0].variant?.name).toBe('39');
    expect(searchPosProducts(products, '8435000000383')[0].variant?.name).toBe('38');
  });

  it('ordena: código exacto, nombre que empieza por lo escrito y el resto', () => {
    const zueco = searchPosProducts(products, 'zueco').map((h) => h.product);
    expect(zueco).toEqual([denia, bolso]);
    const codigo = searchPosProducts(products, 'bol-1');
    expect(codigo[0]).toMatchObject({ product: bolso, variant: null, exactCode: true });
  });
});

describe('lector de códigos del TPV', () => {
  it('encuentra la talla o el producto por código de barras o SKU, sin mayúsculas', () => {
    expect(findByCode(products, '8435000000376')?.variant?.name).toBe('37');
    expect(findByCode(products, ' tssd25zu001-38 ')?.variant?.name).toBe('38');
    expect(findByCode(products, '8435000009999')).toMatchObject({ product: paris, variant: null });
    expect(findByCode(products, 'BOL-1')).toMatchObject({ product: bolso, variant: null });
  });

  it('un código parcial o vacío no encuentra nada', () => {
    expect(findByCode(products, '843500000')).toBeNull();
    expect(findByCode(products, '  ')).toBeNull();
  });
});
