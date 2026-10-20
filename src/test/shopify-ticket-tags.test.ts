import { describe, expect, it } from 'vitest';
import { posOrderAttributes, posTicketTags, shopifyTag } from '../../supabase/functions/_shared/shopify-core';

describe('shopifyTag', () => {
  it('quita comas, junta espacios y corta a 40 caracteres', () => {
    expect(shopifyTag('VTA-000123')).toBe('VTA-000123');
    expect(shopifyTag('  Vendedor:  Ana,  López ')).toBe('Vendedor: Ana López');
    expect(shopifyTag('x'.repeat(60))).toHaveLength(40);
    expect(shopifyTag('  ')).toBeNull();
    expect(shopifyTag(null)).toBeNull();
  });
});

describe('posTicketTags y posOrderAttributes', () => {
  it('ticket siempre; vendedor solo si lo hay', () => {
    expect(posTicketTags('VTA-000002', 'Ana')).toEqual(['VTA-000002', 'Vendedor: Ana']);
    expect(posTicketTags('VTA-000002', null)).toEqual(['VTA-000002']);
    expect(posOrderAttributes('VTA-000002', 'Ana')).toEqual([
      { key: 'Ticket', value: 'VTA-000002' },
      { key: 'Vendedor', value: 'Ana' },
    ]);
    expect(posOrderAttributes('VTA-000002', '  ')).toEqual([{ key: 'Ticket', value: 'VTA-000002' }]);
  });
});
