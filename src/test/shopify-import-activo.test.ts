import { describe, expect, it } from 'vitest';
import { isShopifyProductActive } from '@/lib/shopify';

describe('isShopifyProductActive', () => {
  it('solo ACTIVE se vende; borradores, archivados y desconocidos quedan inactivos', () => {
    expect(isShopifyProductActive('ACTIVE')).toBe(true);
    expect(isShopifyProductActive('active')).toBe(true);
    expect(isShopifyProductActive('DRAFT')).toBe(false);
    expect(isShopifyProductActive('ARCHIVED')).toBe(false);
    expect(isShopifyProductActive(null)).toBe(false);
    expect(isShopifyProductActive(undefined)).toBe(false);
  });
});
