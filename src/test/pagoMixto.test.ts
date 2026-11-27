import { describe, expect, it } from 'vitest';
import { cashChange, largestPaymentMethod, mixedPayments, mixedSplit } from '@/lib/cobro';
import { planRefundTransactions, posSaleTransactions, type ShopifyOrderTransaction } from '../../supabase/functions/_shared/shopify-core';
import { renderTicketBody, type TicketDoc } from '@/lib/ticket';
import { saleTicketDoc, type StoredSaleRow } from '@/lib/saleTicket';

describe('pago mixto en el TPV', () => {
  it('se escribe la tarjeta y el resto es efectivo', () => {
    expect(mixedSplit(129, '79')).toEqual({ card: 79, cash: 50, problem: null });
    expect(mixedSplit(129, '79,50')).toEqual({ card: 79.5, cash: 49.5, problem: null });
    expect(mixedPayments(mixedSplit(129, '79'))).toEqual([{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }]);
  });

  it('las dos partes tienen que ser mayores que 0', () => {
    expect(mixedSplit(129, '').problem).toMatch(/cuánto se cobra con tarjeta/);
    expect(mixedSplit(129, '0').problem).toMatch(/mayor que 0/);
    expect(mixedSplit(129, '129').problem).toMatch(/elige «Tarjeta»/);
    expect(mixedSplit(129, '200').problem).toMatch(/menos de 129,00/);
  });

  it('el cambio, solo sobre la parte en efectivo', () => {
    const split = mixedSplit(129, '79');
    expect(cashChange('60', split.cash)).toBe(10);
    expect(cashChange('40', split.cash)).toBe(-10);
  });

  it('la devolución propone la forma de pago que más pagó; con empate, la tarjeta', () => {
    expect(largestPaymentMethod([{ method: 'card', amount: 79 }, { method: 'cash', amount: '50' }])).toBe('card');
    expect(largestPaymentMethod([{ method: 'card', amount: 20 }, { method: 'cash', amount: 109 }])).toBe('cash');
    expect(largestPaymentMethod([{ method: 'cash', amount: 50 }, { method: 'card', amount: 50 }])).toBe('card');
    expect(largestPaymentMethod([])).toBeNull();
    expect(largestPaymentMethod(null)).toBeNull();
  });
});

describe('pago mixto en Shopify', () => {
  it('un cobro por forma de pago, y el vale aparte', () => {
    expect(posSaleTransactions(129, 0, [{ gateway: 'Tarjeta', amount: 79 }, { gateway: 'Efectivo', amount: 50 }])).toEqual([
      { gateway: 'Tarjeta', amount: 79 },
      { gateway: 'Efectivo', amount: 50 },
    ]);
    expect(posSaleTransactions(129, 29, [{ gateway: 'Tarjeta', amount: 60 }, { gateway: 'Efectivo', amount: 40 }])).toEqual([
      { gateway: 'Vale de tienda', amount: 29 },
      { gateway: 'Tarjeta', amount: 60 },
      { gateway: 'Efectivo', amount: 40 },
    ]);
  });

  it('las partes no pasan del resto (una propina no va al pedido)', () => {
    expect(posSaleTransactions(100, 0, [{ gateway: 'Tarjeta', amount: 70 }, { gateway: 'Efectivo', amount: 35 }])).toEqual([
      { gateway: 'Tarjeta', amount: 70 },
      { gateway: 'Efectivo', amount: 30 },
    ]);
  });

  it('el reembolso empieza por la forma en que se devuelve', () => {
    const tx = (id: string, gateway: string, amount: number): ShopifyOrderTransaction => ({
      id, kind: 'SALE', status: 'SUCCESS', gateway, amountSet: { shopMoney: { amount: String(amount) } },
    });
    const pedido = [tx('t', 'Tarjeta', 79), tx('e', 'Efectivo', 50)];
    expect(planRefundTransactions(pedido, 40, 'Efectivo')).toEqual([{ parentId: 'e', gateway: 'Efectivo', amount: 40 }]);
    expect(planRefundTransactions(pedido, 60, 'Efectivo')).toEqual([
      { parentId: 'e', gateway: 'Efectivo', amount: 50 },
      { parentId: 't', gateway: 'Tarjeta', amount: 10 },
    ]);
    expect(planRefundTransactions(pedido, 40, 'Tarjeta')).toEqual([{ parentId: 't', gateway: 'Tarjeta', amount: 40 }]);
    // Sin preferencia, como antes.
    expect(planRefundTransactions(pedido, 40)).toEqual([{ parentId: 't', gateway: 'Tarjeta', amount: 40 }]);
  });
});

describe('pago mixto en el ticket', () => {
  const venta: TicketDoc = {
    kind: 'sale', number: 'VTA-000100', createdAt: new Date(2026, 11, 2), taxRate: 21, total: 129,
    paymentMethod: 'mixed', cashReceived: 60, change: 10,
    payments: [{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }],
    lines: [{ name: 'Botín', quantity: 1, unitPrice: 129, total: 129 }],
  };

  it('cada forma de pago con su importe, y el entregado y el cambio del efectivo', () => {
    const html = renderTicketBody({ name: 'Tienda' }, venta);
    expect(html).toMatch(/Tarjeta<\/span><span>79,00 €/);
    expect(html).toMatch(/Efectivo<\/span><span>50,00 €/);
    expect(html).toMatch(/Entregado<\/span><span>60,00 €/);
    expect(html).not.toContain('Mixto');
  });

  it('con una sola forma de pago, como siempre', () => {
    const html = renderTicketBody({ name: 'Tienda' }, { ...venta, paymentMethod: 'card', payments: null, cashReceived: null, change: null });
    expect(html).toMatch(/Pago<\/span><span>Tarjeta/);
  });

  it('la reimpresión lleva las formas de pago, la tarjeta primero', () => {
    const row: StoredSaleRow = {
      sale_number: 'VTA-000100', created_at: '2026-12-02T10:00:00Z', payment_method: 'mixed', total: 129, tip: 0,
      cash_received: 60, change_given: 10, notes: null, voucher_amount: 0, clients: null, store_vouchers: null,
      payments: [{ method: 'cash', amount: '50.00' }, { method: 'card', amount: '79.00' }],
      sale_items: [{ product_name: 'Botín', quantity: 1, unit_price: 129, total: 129, compare_at_price: null }],
    } as StoredSaleRow;
    expect(saleTicketDoc(row, 21, null).payments).toEqual([{ method: 'card', amount: 79 }, { method: 'cash', amount: 50 }]);
  });
});
