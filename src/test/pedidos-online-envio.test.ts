import { describe, expect, it } from 'vitest';
import {
  fulfillmentOrdersToShip, mergeOrderStatus, shipmentTracking,
} from '../../supabase/functions/_shared/shopify-core';
import { groupPickingLines, renderPickingList, type PickingOrder } from '@/lib/pickingList';

describe('mergeOrderStatus', () => {
  it('un aviso de un pedido sin enviar no deshace «Preparando» ni «Aceptado»', () => {
    expect(mergeOrderStatus('preparing', 'accepted')).toBe('preparing');
    expect(mergeOrderStatus('preparing', 'pending')).toBe('preparing');
    expect(mergeOrderStatus('accepted', 'pending')).toBe('accepted');
  });

  it('Shopify manda en enviado, cancelado y devuelto', () => {
    expect(mergeOrderStatus('preparing', 'shipped')).toBe('shipped');
    expect(mergeOrderStatus('preparing', 'cancelled')).toBe('cancelled');
    expect(mergeOrderStatus('accepted', 'returned')).toBe('returned');
    expect(mergeOrderStatus('delivered', 'returned')).toBe('returned');
  });

  it('«Entregado» no vuelve a «Enviado»', () => {
    expect(mergeOrderStatus('delivered', 'shipped')).toBe('delivered');
  });

  it('un pedido nuevo toma el estado de Shopify', () => {
    expect(mergeOrderStatus(null, 'accepted')).toBe('accepted');
    expect(mergeOrderStatus(undefined, 'pending')).toBe('pending');
  });
});

describe('fulfillmentOrdersToShip', () => {
  it('solo los bloques abiertos o en curso, uno por ubicación', () => {
    expect(fulfillmentOrdersToShip([
      { id: 'a', status: 'OPEN' },
      { id: 'b', status: 'CLOSED' },
      { id: 'c', status: 'IN_PROGRESS' },
      { id: 'd', status: 'ON_HOLD' },
      { id: 'e', status: 'CANCELLED' },
    ])).toEqual(['a', 'c']);
  });

  it('nada que enviar si ya está todo enviado', () => {
    expect(fulfillmentOrdersToShip([{ id: 'a', status: 'CLOSED' }])).toEqual([]);
  });
});

describe('shipmentTracking', () => {
  it('transportista y número', () => {
    expect(shipmentTracking(' Correos ', ' PQ6C8N980524928K ')).toEqual({ company: 'Correos', number: 'PQ6C8N980524928K' });
  });

  it('sin número no hay seguimiento; sin transportista, solo el número', () => {
    expect(shipmentTracking('Correos', '  ')).toBeUndefined();
    expect(shipmentTracking('', 'ABC')).toEqual({ number: 'ABC' });
  });
});

const orders: PickingOrder[] = [
  {
    name: '#1T6593ES', customer: 'Ana', city: 'Valencia',
    lines: [
      { title: 'Zueco Cullera Piel Negro', size: '38', sku: 'TFW23ZU000NE38', barcode: '1', quantity: 1 },
      { title: 'Calcetines Zueco Berenjena Verde', size: '35-38', sku: null, barcode: null, quantity: 2 },
    ],
  },
  {
    name: '#1T6592ES', customer: 'Bea', city: null,
    lines: [
      { title: 'Zueco Cullera Piel Negro', size: '38', sku: 'tfw23zu000ne38', barcode: '1', quantity: 1 },
      { title: 'Zueco Cullera Piel Negro', size: '37', sku: 'TFW23ZU000NE37', barcode: '2', quantity: 1 },
      { title: 'Calcetines Zueco Berenjena Verde', size: '35-38', sku: null, barcode: null, quantity: 1 },
      { title: 'Devuelto', size: null, sku: 'X', barcode: null, quantity: 0 },
    ],
  },
];

describe('groupPickingLines', () => {
  it('suma por SKU (sin mayúsculas) o, sin SKU, por nombre y talla, y apunta los pedidos', () => {
    const rows = groupPickingLines(orders);
    expect(rows.map((r) => [r.title, r.size, r.quantity, r.orders])).toEqual([
      ['Calcetines Zueco Berenjena Verde', '35-38', 3, ['#1T6593ES', '#1T6592ES']],
      ['Zueco Cullera Piel Negro', '37', 1, ['#1T6592ES']],
      ['Zueco Cullera Piel Negro', '38', 2, ['#1T6593ES', '#1T6592ES']],
    ]);
  });

  it('las líneas sin unidades (devueltas) no salen', () => {
    expect(groupPickingLines(orders).some((r) => r.title === 'Devuelto')).toBe(false);
  });
});

describe('renderPickingList', () => {
  it('lleva el total de unidades y escapa el texto', () => {
    const html = renderPickingList([{ name: '<b>#1</b>', customer: 'A & B', city: null, lines: [{ title: 'Zueco', size: '38', sku: null, barcode: null, quantity: 2 }] }], new Date(2026, 11, 1, 9, 0));
    expect(html).toContain('1 pedidos · 2 unidades');
    expect(html).toContain('&lt;b&gt;#1&lt;/b&gt;');
    expect(html).toContain('A &amp; B');
  });
});
