import { describe, expect, it } from 'vitest';
import { pickPushLevel } from '../../supabase/functions/_shared/shopify-core';
import {
  LEVEL_IDS_PER_QUERY,
  LEVEL_PAGE_SIZE,
  loadLevelsFor,
  type LevelColumn,
} from '../../supabase/functions/_shared/shopify-levels';
import { findRefundLine } from '../../supabase/functions/_shared/shopify-core';

interface Fila {
  id: string;
  local_variant_id: string | null;
  local_product_id: string | null;
}

/** Tabla falsa con el tope de 1.000 filas por consulta de la API de la base de datos. */
const tabla = (filas: Fila[]) => {
  const consultas: { column: LevelColumn; ids: number; from: number; to: number }[] = [];
  const fetchPage = async (column: LevelColumn, ids: string[], from: number, to: number) => {
    consultas.push({ column, ids: ids.length, from, to });
    const hits = filas.filter((f) => ids.includes(f[column] as string)).sort((a, b) => a.id.localeCompare(b.id));
    return hits.slice(from, Math.min(to + 1, from + 1000));
  };
  return { fetchPage, consultas };
};

// 2.527 filas como en Tuilus el 21/10: el calcetín queda más allá de la fila 1.000.
const catalogo: Fila[] = Array.from({ length: 2527 }, (_, i) => ({
  id: `n${String(i).padStart(5, '0')}`,
  local_variant_id: `v${i}`,
  local_product_id: `p${Math.floor(i / 20)}`,
}));

describe('emparejamientos de stock de unos artículos', () => {
  it('encuentra una variante que queda más allá de las primeras 1.000 filas', async () => {
    const { fetchPage } = tabla(catalogo);
    const filas = await loadLevelsFor(fetchPage, { variantIds: ['v2000'] });
    expect(filas.map((f) => f.id)).toEqual(['n02000']);
  });

  it('pide los ids por tandas y sin repetidos ni vacíos', async () => {
    const { fetchPage, consultas } = tabla(catalogo);
    const ids = Array.from({ length: 250 }, (_, i) => `v${i}`);
    const filas = await loadLevelsFor(fetchPage, { variantIds: [...ids, 'v1', null, undefined] });
    expect(filas).toHaveLength(250);
    expect(consultas.map((c) => c.ids)).toEqual([LEVEL_IDS_PER_QUERY, LEVEL_IDS_PER_QUERY, 50]);
  });

  it('pagina cuando una tanda tiene más filas que una página', async () => {
    const muchas: Fila[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `m${String(i).padStart(5, '0')}`,
      local_variant_id: null,
      local_product_id: 'pGrande',
    }));
    const { fetchPage, consultas } = tabla(muchas);
    const filas = await loadLevelsFor(fetchPage, { productIds: ['pGrande'] });
    expect(filas).toHaveLength(1200);
    expect(consultas.map((c) => c.from)).toEqual([0, LEVEL_PAGE_SIZE, 2 * LEVEL_PAGE_SIZE]);
  });

  it('junta variantes y productos sin repetir filas', async () => {
    const { fetchPage } = tabla(catalogo);
    const filas = await loadLevelsFor(fetchPage, { variantIds: ['v0'], productIds: ['p0'] });
    expect(filas).toHaveLength(20);
  });
});

describe('línea del pedido a reembolsar', () => {
  const lineas = [
    { id: 'L1', title: 'Calcetines · 35-38', variant: null },
    { id: 'L2', title: 'Zueco Rio · 38', variant: { id: 'gid://shopify/ProductVariant/2' } },
  ];
  const quedan = (m: Record<string, number>) => new Map(Object.entries(m));

  it('busca primero por variante', () => {
    const l = findRefundLine(lineas, quedan({ L1: 1, L2: 1 }), { variantGid: 'gid://shopify/ProductVariant/2', productName: 'x' });
    expect(l?.id).toBe('L2');
  });

  it('en pedidos antiguos con la línea suelta, la encuentra por nombre', () => {
    const l = findRefundLine(lineas, quedan({ L1: 1, L2: 1 }), {
      variantGid: 'gid://shopify/ProductVariant/9',
      productName: 'Calcetines · 35-38',
    });
    expect(l?.id).toBe('L1');
  });

  it('no coge la línea de otra variante aunque se llame igual', () => {
    const l = findRefundLine(lineas, quedan({ L1: 1, L2: 1 }), {
      variantGid: 'gid://shopify/ProductVariant/9',
      productName: 'Zueco Rio · 38',
    });
    expect(l).toBeUndefined();
  });

  it('salta las líneas ya reembolsadas', () => {
    const l = findRefundLine(lineas, quedan({ L1: 0, L2: 1 }), { variantGid: null, productName: 'Calcetines · 35-38' });
    expect(l).toBeUndefined();
  });
});

describe('ubicación de cada envío de stock', () => {
  const nivel = (location_gid: string, available: number, variant = 'v1') => ({
    inventory_item_gid: `gid://shopify/InventoryItem/${variant}`, location_gid, available, local_variant_id: variant, local_product_id: 'p1',
  });
  const niveles = [nivel('TIENDA', 5), nivel('MADRID', 1), nivel('TIENDA', 3, 'v2')];

  it('sin ubicación, la de la tienda; si no está, la de más stock', () => {
    expect(pickPushLevel(niveles, { local_variant_id: 'v1', local_product_id: null }, 'TIENDA')?.location_gid).toBe('TIENDA');
    expect(pickPushLevel([nivel('MADRID', 1), nivel('OTRA', 4)], { local_variant_id: 'v1', local_product_id: null }, 'TIENDA')?.location_gid).toBe('OTRA');
    expect(pickPushLevel(niveles, { local_variant_id: 'v9', local_product_id: null }, 'TIENDA')).toBeNull();
  });

  it('con ubicación (compras), solo esa: sin nivel allí no se manda a otra', () => {
    expect(pickPushLevel(niveles, { local_variant_id: 'v1', local_product_id: null, location_gid: 'MADRID' }, 'TIENDA')?.location_gid).toBe('MADRID');
    expect(pickPushLevel(niveles, { local_variant_id: 'v2', local_product_id: null, location_gid: 'MADRID' }, 'TIENDA')).toBeNull();
  });
});
