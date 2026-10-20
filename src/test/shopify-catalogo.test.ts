import { describe, expect, it } from 'vitest';
import {
  catalogAction,
  levelRowsNeedingStock,
  productGidFromPayload,
  variantsToDeactivate,
  type LevelPairing,
} from '../../supabase/functions/_shared/shopify-core';

describe('productGidFromPayload', () => {
  it('usa el GID del aviso o lo construye con el id numérico', () => {
    expect(productGidFromPayload({ admin_graphql_api_id: 'gid://shopify/Product/12', id: 12 })).toBe(
      'gid://shopify/Product/12',
    );
    expect(productGidFromPayload({ id: 34 })).toBe('gid://shopify/Product/34');
    expect(productGidFromPayload({ id: '56' })).toBe('gid://shopify/Product/56');
  });

  it('rechaza avisos sin un id de producto válido', () => {
    expect(productGidFromPayload({})).toBeNull();
    expect(productGidFromPayload({ admin_graphql_api_id: 'gid://shopify/Order/1' })).toBeNull();
    expect(productGidFromPayload({ id: -1 })).toBeNull();
    expect(productGidFromPayload({ id: 'abc' })).toBeNull();
  });
});

describe('catalogAction', () => {
  it('un producto activo entra si no está, y se actualiza si ya está', () => {
    expect(catalogAction('ACTIVE', false)).toBe('import');
    expect(catalogAction('ACTIVE', true)).toBe('update');
  });

  it('borradores, archivados y borrados: se desactivan si estaban, si no se ignoran', () => {
    expect(catalogAction('DRAFT', false)).toBe('skip');
    expect(catalogAction('ARCHIVED', false)).toBe('skip');
    expect(catalogAction(null, false)).toBe('skip');
    expect(catalogAction('DRAFT', true)).toBe('deactivate');
    expect(catalogAction('ARCHIVED', true)).toBe('deactivate');
    expect(catalogAction(null, true)).toBe('deactivate');
  });
});

describe('variantsToDeactivate', () => {
  it('devuelve las tallas locales que ya no están en Shopify', () => {
    expect(variantsToDeactivate(['v1', 'v2', 'v3'], ['v1', 'v3', 'v4'])).toEqual(['v2']);
    expect(variantsToDeactivate(['v1'], ['v1'])).toEqual([]);
    expect(variantsToDeactivate(['v1', 'v2'], [])).toEqual(['v1', 'v2']);
  });
});

describe('levelRowsNeedingStock', () => {
  type Row = { inventory_item_gid: string; variant_external_id: string };
  const rows: Row[] = [
    { inventory_item_gid: 'i1', variant_external_id: 'v1' },
    { inventory_item_gid: 'i2', variant_external_id: 'v2' },
    { inventory_item_gid: 'i3', variant_external_id: 'v3' },
  ];
  const expected = (row: Row): LevelPairing => ({
    local_product_id: 'p1',
    local_variant_id: `local-${row.variant_external_id}`,
  });

  it('solo pone stock a los artículos nuevos o reemparejados', () => {
    const known = new Map<string, LevelPairing>([
      ['i1', { local_product_id: 'p1', local_variant_id: 'local-v1' }], // igual: no se toca
      ['i2', { local_product_id: 'p1', local_variant_id: null }], // pasa a tener variante
    ]);
    expect(levelRowsNeedingStock<Row>(rows, known, expected).map((r) => r.inventory_item_gid)).toEqual(['i2', 'i3']);
  });

  it('con un producto nuevo, todos sus artículos', () => {
    expect(levelRowsNeedingStock<Row>(rows, new Map(), expected)).toHaveLength(3);
  });
});
