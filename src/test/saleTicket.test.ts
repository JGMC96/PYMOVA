import { describe, expect, it } from 'vitest';
import { saleTicketDoc, type StoredSaleRow } from '@/lib/saleTicket';
import { renderTicketBody } from '@/lib/ticket';

const base: StoredSaleRow = {
  sale_number: 'VTA-000006',
  created_at: '2026-10-22T17:00:02Z',
  payment_method: 'card',
  total: '129.05',
  tip: '0',
  cash_received: null,
  change_given: null,
  notes: null,
  voucher_amount: '0',
  clients: null,
  store_vouchers: null,
  sale_items: [
    { product_name: 'Sandalia París Gris - 38', quantity: 1, unit_price: '155', total: '124' },
    { product_name: 'Calcetines', quantity: '2', unit_price: '6', total: null },
  ],
};

describe('reimprimir el ticket de una venta', () => {
  it('rehace líneas, descuentos y pago', () => {
    const doc = saleTicketDoc(base, 21, 'Rocío');
    expect(doc).toMatchObject({ kind: 'sale', number: 'VTA-000006', total: 129.05, paymentMethod: 'card', cashier: 'Rocío' });
    expect(doc.lines).toEqual([
      { name: 'Sandalia París Gris - 38', quantity: 1, unitPrice: 155, total: 124, discount: 31 },
      { name: 'Calcetines', quantity: 2, unitPrice: 6, total: 12, discount: 0 },
    ]);
    const html = renderTicketBody({ name: 'TUILUS' }, doc);
    expect(html).toContain('VTA-000006');
    expect(html).toMatch(/Pago<\/span><span>Tarjeta/);
  });

  it('con vale y efectivo, como en el TPV', () => {
    const doc = saleTicketDoc(
      {
        ...base, payment_method: 'cash', total: '100', voucher_amount: '60', cash_received: '50', change_given: '10',
        store_vouchers: { code: 'VALE-ABCD2345' }, clients: { name: 'Clienta' },
      },
      21,
      null,
    );
    expect(doc.total).toBe(40);
    expect(doc.voucherPaid).toEqual({ code: 'VALE-ABCD2345', amount: 60, balanceLeft: null });
    expect(doc).toMatchObject({ cashReceived: 50, change: 10, clientName: 'Clienta' });
  });
});
