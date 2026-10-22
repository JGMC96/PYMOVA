import { describe, expect, it } from 'vitest';
import { historyBuyers, lineItemName } from '../../supabase/functions/_shared/shopify-history';

const ana = { id: 'gid://shopify/Customer/9', firstName: 'Ana', lastName: 'Pérez', email: 'ana@ejemplo.test', phone: null };

describe('historial de pedidos de Shopify', () => {
  it('nombre del artículo con su talla', () => {
    expect(lineItemName('Zueco Rio Tira Pelo Cow', '38')).toBe('Zueco Rio Tira Pelo Cow - 38');
    expect(lineItemName('Tarjeta regalo', 'Default Title')).toBe('Tarjeta regalo');
    expect(lineItemName('Calcetines', null)).toBe('Calcetines');
    expect(lineItemName('Calcetines', '  ')).toBe('Calcetines');
  });

  it('quien compró, una vez por clienta', () => {
    expect(historyBuyers([{ customer: ana }, { customer: { ...ana } }, { customer: null }, { customer: { ...ana, id: null } }])).toEqual([ana]);
  });
});
