import { describe, expect, it } from 'vitest';
import {
  availableAtLocation,
  levelFromInventoryWebhook,
  levelsFromInventoryItemNodes,
  toShopifyGid,
} from '../../supabase/functions/_shared/shopify-core';

describe('toShopifyGid', () => {
  it('convierte ids numéricos y respeta los GID', () => {
    expect(toShopifyGid('Location', 68634837246)).toBe('gid://shopify/Location/68634837246');
    expect(toShopifyGid('InventoryItem', '42')).toBe('gid://shopify/InventoryItem/42');
    expect(toShopifyGid('Location', 'gid://shopify/Location/7')).toBe('gid://shopify/Location/7');
  });

  it('rechaza valores que no son ids', () => {
    expect(toShopifyGid('Location', null)).toBeNull();
    expect(toShopifyGid('Location', -3)).toBeNull();
    expect(toShopifyGid('Location', 'gid://shopify/InventoryItem/7')).toBeNull();
  });
});

describe('levelFromInventoryWebhook', () => {
  it('lee el payload de inventory_levels/update', () => {
    expect(
      levelFromInventoryWebhook({
        inventory_item_id: 49011,
        location_id: 68634837246,
        available: 3,
        updated_at: '2026-10-20T12:00:00+02:00',
      }),
    ).toEqual({
      inventory_item_gid: 'gid://shopify/InventoryItem/49011',
      location_gid: 'gid://shopify/Location/68634837246',
      available: 3,
      updated_at: '2026-10-20T12:00:00+02:00',
    });
  });

  it('devuelve null si falta el artículo, la ubicación o la cantidad', () => {
    expect(levelFromInventoryWebhook({ location_id: 1, available: 3 })).toBeNull();
    expect(levelFromInventoryWebhook({ inventory_item_id: 1, available: 3 })).toBeNull();
    expect(levelFromInventoryWebhook({ inventory_item_id: 1, location_id: 1, available: null })).toBeNull();
  });
});

describe('levelsFromInventoryItemNodes', () => {
  it('saca un nivel por ubicación e ignora nodos vacíos', () => {
    const niveles = levelsFromInventoryItemNodes([
      {
        id: 'gid://shopify/InventoryItem/1',
        inventoryLevels: {
          edges: [
            { node: { updatedAt: '2026-10-20T10:00:00Z', location: { id: 'gid://shopify/Location/1', name: 'Tienda' }, quantities: [{ name: 'available', quantity: 4 }] } },
            { node: { updatedAt: null, location: { id: 'gid://shopify/Location/2', name: 'Almacén' }, quantities: [{ name: 'available', quantity: 0 }] } },
          ],
        },
      },
      null,
      {},
    ]);
    expect(niveles).toEqual([
      { inventory_item_gid: 'gid://shopify/InventoryItem/1', location_gid: 'gid://shopify/Location/1', location_name: 'Tienda', available: 4, updated_at: '2026-10-20T10:00:00Z' },
      { inventory_item_gid: 'gid://shopify/InventoryItem/1', location_gid: 'gid://shopify/Location/2', location_name: 'Almacén', available: 0, updated_at: null },
    ]);
  });
});

describe('availableAtLocation', () => {
  const fila = (location_gid: string, available: number) => ({
    variant_external_id: 'v', inventory_item_gid: 'i', location_gid, location_name: '', available,
  });
  const filas = [fila('gid://shopify/Location/1', 4), fila('gid://shopify/Location/2', 7)];

  it('da el disponible de la ubicación de la tienda', () => {
    expect(availableAtLocation(filas, 'gid://shopify/Location/1')).toBe(4);
  });

  it('da 0 si el artículo no está en la tienda y la suma si no hay ubicación por defecto', () => {
    expect(availableAtLocation([fila('gid://shopify/Location/2', 7)], 'gid://shopify/Location/1')).toBe(0);
    expect(availableAtLocation(filas, null)).toBe(11);
  });

  it('sin niveles no hay dato', () => {
    expect(availableAtLocation([], 'gid://shopify/Location/1')).toBeNull();
  });
});
