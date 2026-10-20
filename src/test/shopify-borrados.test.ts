import { describe, expect, it } from 'vitest';
import { productsGoneFromShopify } from '../../supabase/functions/_shared/shopify-core';

describe('productsGoneFromShopify', () => {
  it('desactiva los borrados (null) y los no activos; deja los activos', () => {
    const ids = ['gid://shopify/Product/1', 'gid://shopify/Product/2', 'gid://shopify/Product/3', 'gid://shopify/Product/4'];
    const nodes = [
      { id: 'gid://shopify/Product/1', status: 'ACTIVE' },
      null,
      { id: 'gid://shopify/Product/3', status: 'DRAFT' },
      { id: 'gid://shopify/Product/4', status: 'ARCHIVED' },
    ];
    expect(productsGoneFromShopify(ids, nodes)).toEqual(ids.slice(1));
  });

  it('si Shopify devuelve menos nodos o desordenados, solo se fía del que coincide', () => {
    const ids = ['gid://shopify/Product/1', 'gid://shopify/Product/2'];
    expect(productsGoneFromShopify(ids, [{ id: 'gid://shopify/Product/2', status: 'ACTIVE' }])).toEqual(ids);
    expect(productsGoneFromShopify(ids, [])).toEqual(ids);
    expect(productsGoneFromShopify([], [])).toEqual([]);
  });
});
