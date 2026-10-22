import { describe, expect, it } from 'vitest';
import { planRefundTransactions, posSaleTransactions, refundAmountForReturn } from '../../supabase/functions/_shared/shopify-core';

describe('refundAmountForReturn', () => {
  it('suma las líneas devueltas', () => {
    expect(refundAmountForReturn([{ quantity: 2, unit_price: 10 }, { quantity: 1, unit_price: 5.5 }], 100, 0)).toBe(25.5);
  });

  it('nunca supera el total de la venta', () => {
    expect(refundAmountForReturn([{ quantity: 3, unit_price: 50 }], 100, 0)).toBe(100);
  });

  it('descuenta lo ya reembolsado de esa venta', () => {
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 80 }], 100, 40)).toBe(60);
  });

  it('devuelve 0 sin líneas o cuando no queda nada por reembolsar', () => {
    expect(refundAmountForReturn([], 100, 0)).toBe(0);
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 10 }], 100, 100)).toBe(0);
  });

  it('redondea a céntimos', () => {
    expect(refundAmountForReturn([{ quantity: 3, unit_price: 33.333 }], 500, 0)).toBe(100);
  });

  it('usa lo cobrado en la línea (con descuento) cuando la devolución lo trae', () => {
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 99, total: 89.1 }], 178.2, 0)).toBe(89.1);
    expect(refundAmountForReturn([{ quantity: 1, unit_price: 99, total: null }], 178.2, 0)).toBe(99);
  });
});

describe('cobros y reembolsos con vale de tienda', () => {
  it('el pedido separa lo pagado con vale y el resto', () => {
    expect(posSaleTransactions(200, 60, 'Efectivo')).toEqual([
      { gateway: 'Vale de tienda', amount: 60 },
      { gateway: 'Efectivo', amount: 140 },
    ]);
    expect(posSaleTransactions(100, 100, 'Vale de tienda')).toEqual([{ gateway: 'Vale de tienda', amount: 100 }]);
    expect(posSaleTransactions(50, 0, 'Tarjeta')).toEqual([{ gateway: 'Tarjeta', amount: 50 }]);
    expect(posSaleTransactions(50, null as never, 'Tarjeta')).toEqual([{ gateway: 'Tarjeta', amount: 50 }]);
  });

  it('reparte el reembolso: primero el dinero, después el vale, sin pasar de lo que queda', () => {
    const tx = (id: string, kind: string, gateway: string, amount: number, parent?: string) => ({
      id, kind, status: 'SUCCESS', gateway, amountSet: { shopMoney: { amount: amount.toFixed(2) } },
      parentTransaction: parent ? { id: parent } : null,
    });
    const venta = [tx('v', 'SALE', 'Vale de tienda', 60), tx('e', 'SALE', 'Efectivo', 140)];
    expect(planRefundTransactions(venta, 100)).toEqual([{ parentId: 'e', gateway: 'Efectivo', amount: 100 }]);
    expect(planRefundTransactions(venta, 170)).toEqual([
      { parentId: 'e', gateway: 'Efectivo', amount: 140 },
      { parentId: 'v', gateway: 'Vale de tienda', amount: 30 },
    ]);
    // Con un reembolso anterior de 120 € en efectivo, solo quedan 20 € ahí.
    const conPrevio = [...venta, tx('r', 'REFUND', 'Efectivo', 120, 'e')];
    expect(planRefundTransactions(conPrevio, 50)).toEqual([
      { parentId: 'e', gateway: 'Efectivo', amount: 20 },
      { parentId: 'v', gateway: 'Vale de tienda', amount: 30 },
    ]);
    // Un pedido de un solo cobro, como hasta ahora.
    expect(planRefundTransactions([tx('t', 'SALE', 'Tarjeta', 89)], 89)).toEqual([{ parentId: 't', gateway: 'Tarjeta', amount: 89 }]);
    // Cobros fallidos no cuentan.
    expect(planRefundTransactions([{ ...tx('f', 'SALE', 'Tarjeta', 50), status: 'FAILURE' }], 10)).toEqual([]);
  });
});
