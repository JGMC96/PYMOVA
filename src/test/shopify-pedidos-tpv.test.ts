import { describe, expect, it } from 'vitest';
import { isPymovaPosOrder, orderGidFromPayload } from '../../supabase/functions/_shared/shopify-core';

describe('isPymovaPosOrder', () => {
  it('reconoce la venta de la caja por la etiqueta, en el pedido de la API (lista)', () => {
    expect(isPymovaPosOrder({ tags: ['pymova-tpv', 'Venta en tienda', 'VTA-000056'] })).toBe(true);
  });

  it('y en el aviso de un pedido (texto separado por comas)', () => {
    expect(isPymovaPosOrder({ tags: 'Venta en tienda, pymova-tpv, VTA-000056' })).toBe(true);
  });

  it('un pedido web no lo es', () => {
    expect(isPymovaPosOrder({ tags: ['Dondy'] })).toBe(false);
    expect(isPymovaPosOrder({ tags: 'Dondy' })).toBe(false);
    expect(isPymovaPosOrder({ tags: [] })).toBe(false);
  });

  it('sin etiquetas (el aviso de un reembolso no las trae) no se puede saber: hay que mirar el pedido', () => {
    expect(isPymovaPosOrder({ order_id: 8499001557335 } as { tags?: unknown })).toBe(false);
    expect(isPymovaPosOrder(null)).toBe(false);
  });

  it('una etiqueta que solo contiene el texto no cuenta', () => {
    expect(isPymovaPosOrder({ tags: ['pymova-tpv-prueba'] })).toBe(false);
  });
});

describe('orderGidFromPayload con el aviso de un reembolso', () => {
  it('saca el pedido del order_id, aunque el aviso no traiga sus etiquetas', () => {
    expect(orderGidFromPayload({ id: 1234, order_id: 8499001557335 })).toBe('gid://shopify/Order/8499001557335');
  });
});
