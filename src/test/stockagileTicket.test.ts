import { describe, expect, it } from 'vitest';
import {
  STOCKAGILE_DUPLICATE_LABEL,
  stockagilePaymentLabel,
  stockagileTicketDoc,
  type StoredStockagileSaleRow,
} from '@/lib/saleTicket';
import { renderTicketBody } from '@/lib/ticket';

const venta: StoredStockagileSaleRow = {
  number: 'T-2026-001234',
  sold_at: '2026-10-20T11:30:00Z',
  total: '181.00',
  is_return: false,
  payment_methods: 'Tarjeta',
  customer_name: 'Mostrador',
  clients: { name: 'Clienta Ficha' },
  stockagile_sale_items: [
    { product_name: 'Zueco Rio Tira Pelo Pantera - 39', quantity: 1, unit_price: '175.00', total: '175.00' },
    { product_name: 'Calcetines Zueco Azul Claro Gris - 35-38', quantity: '1', unit_price: '6.00', total: '6.00' },
  ],
};

describe('duplicado de un ticket de Stockagile', () => {
  it('rehace la venta con sus líneas, el pago y la marca de duplicado', () => {
    const doc = stockagileTicketDoc(venta, 21);
    expect(doc).toMatchObject({
      kind: 'sale',
      number: 'T-2026-001234',
      total: 181,
      paymentMethod: 'Tarjeta',
      clientName: 'Clienta Ficha',
      duplicateLabel: STOCKAGILE_DUPLICATE_LABEL,
      originalNumber: null,
    });
    expect(doc.createdAt.toISOString()).toBe('2026-10-20T11:30:00.000Z');
    expect(doc.lines).toEqual([
      { name: 'Zueco Rio Tira Pelo Pantera - 39', quantity: 1, unitPrice: 175, total: 175, discount: 0 },
      { name: 'Calcetines Zueco Azul Claro Gris - 35-38', quantity: 1, unitPrice: 6, total: 6, discount: 0 },
    ]);

    const html = renderTicketBody({ name: 'TUILUS' }, doc);
    expect(html).toContain('FACTURA SIMPLIFICADA');
    expect(html).toContain('DUPLICADO · Ticket de Stockagile');
    expect(html).toContain('T-2026-001234');
    expect(html).toMatch(/Pago<\/span><span>Tarjeta/);
    expect(html).toMatch(/IVA 21%<\/span><span>31,41 €/);
  });

  it('sin clienta en la ficha, usa el nombre de Stockagile', () => {
    expect(stockagileTicketDoc({ ...venta, clients: null }, 21).clientName).toBe('Mostrador');
    expect(stockagileTicketDoc({ ...venta, clients: null, customer_name: null }, 21).clientName).toBeNull();
  });

  it('una devolución sale como abono, en positivo, y dice qué ticket rectifica', () => {
    const doc = stockagileTicketDoc(
      {
        ...venta,
        number: 'D-2026-000050',
        total: '-97.00',
        is_return: true,
        payment_methods: 'Metálico',
        stockagile_sale_items: [
          { product_name: 'Botín Mundaka Stripe Piel Negro - 37', quantity: -1, unit_price: '97.00', total: '-97.00' },
        ],
      },
      21,
      'T-2026-001100',
    );
    expect(doc).toMatchObject({ kind: 'refund', total: 97, paymentMethod: 'Efectivo', originalNumber: 'T-2026-001100' });
    expect(doc.lines).toEqual([
      { name: 'Botín Mundaka Stripe Piel Negro - 37', quantity: 1, unitPrice: 97, total: 97, discount: 0 },
    ]);
    const html = renderTicketBody({ name: 'TUILUS' }, doc);
    expect(html).toContain('TICKET DE ABONO');
    expect(html).toMatch(/Rectifica<\/span><span>T-2026-001100/);
    expect(html).toMatch(/TOTAL<\/span><span>-97,00 €/);
  });

  it('un cambio sale como venta, con lo devuelto en negativo', () => {
    const doc = stockagileTicketDoc(
      {
        ...venta,
        total: '20.00',
        is_return: true,
        stockagile_sale_items: [
          { product_name: 'Sandalia París Beige - 38', quantity: -1, unit_price: '155.00', total: '-155.00' },
          { product_name: 'Sandalia París Beige - 39', quantity: 1, unit_price: '175.00', total: '175.00' },
        ],
      },
      21,
      'T-2026-001000',
    );
    expect(doc).toMatchObject({ kind: 'sale', total: 20, originalNumber: 'T-2026-001000' });
    expect(doc.lines.map((l) => [l.quantity, l.total, l.discount])).toEqual([
      [-1, -155, 0],
      [1, 175, 0],
    ]);
  });

  it('sin precio unitario lo saca del total, y marca el descuento', () => {
    const doc = stockagileTicketDoc(
      {
        ...venta,
        total: '124.00',
        stockagile_sale_items: [
          { product_name: 'Regalo', quantity: 2, unit_price: null, total: '10.00' },
          { product_name: 'Sandalia', quantity: 1, unit_price: '155.00', total: '114.00' },
        ],
      },
      21,
    );
    expect(doc.lines).toEqual([
      { name: 'Regalo', quantity: 2, unitPrice: 5, total: 10, discount: 0 },
      { name: 'Sandalia', quantity: 1, unitPrice: 155, total: 114, discount: 41 },
    ]);
  });
});

describe('forma de pago de Stockagile', () => {
  it('traduce Metálico y Tarjeta, también los dos juntos', () => {
    expect(stockagilePaymentLabel('Metálico')).toBe('Efectivo');
    expect(stockagilePaymentLabel('Tarjeta')).toBe('Tarjeta');
    expect(stockagilePaymentLabel('Metálico · Tarjeta')).toBe('Efectivo · Tarjeta');
    expect(stockagilePaymentLabel('Bizum')).toBe('Bizum');
    expect(stockagilePaymentLabel(null)).toBeUndefined();
    expect(stockagilePaymentLabel('  ')).toBeUndefined();
  });
});
