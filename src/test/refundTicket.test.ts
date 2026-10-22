import { describe, expect, it } from 'vitest';
import { refundTicketDoc } from '@/hooks/useSaleReturns';

describe('refundTicketDoc', () => {
  it('convierte la devolución guardada en ticket de abono', () => {
    const doc = refundTicketDoc(
      {
        return_number: 'DEV-000004',
        refund_method: 'cash',
        reason: 'Talla pequeña',
        total: '139.50',
        created_at: '2026-10-20T10:00:00Z',
        sales: { sale_number: 'VTA-000012' },
        sale_return_items: [
          { product_name: 'Zueco · 38', quantity: '1', unit_price: '155', total: '139.50' },
          { product_name: 'Calcetín', quantity: 2, unit_price: 6, total: null },
        ],
      },
      21,
      'Ana',
    );
    expect(doc).toMatchObject({
      kind: 'refund',
      number: 'DEV-000004',
      originalNumber: 'VTA-000012',
      total: 139.5,
      paymentMethod: 'cash',
      notes: 'Talla pequeña',
      cashier: 'Ana',
      taxRate: 21,
    });
    expect(doc.lines).toEqual([
      { name: 'Zueco · 38', quantity: 1, unitPrice: 155, total: 139.5 },
      { name: 'Calcetín', quantity: 2, unitPrice: 6, total: 12 },
    ]);
  });

  it('incluye el vale creado con la devolución', () => {
    const doc = refundTicketDoc(
      {
        return_number: 'DEV-000005', refund_method: 'store_credit', reason: null, total: 89, created_at: '2026-10-22T10:00:00Z',
        sales: { sale_number: 'VTA-000020' },
        sale_return_items: [{ product_name: 'Zueco', quantity: 1, unit_price: 89, total: 89 }],
        store_vouchers: [{ code: 'VALE-ABCD2345', initial_amount: '89.00', expires_at: '2027-10-22T10:00:00Z' }],
      },
      21,
      null,
    );
    expect(doc.voucherIssued).toEqual({ code: 'VALE-ABCD2345', amount: 89, expiresAt: new Date('2027-10-22T10:00:00Z') });
    const sinVale = refundTicketDoc(
      { return_number: 'DEV-000006', refund_method: 'cash', reason: null, total: 1, created_at: '2026-10-22T10:00:00Z', sales: null, sale_return_items: [], store_vouchers: [] },
      21,
      null,
    );
    expect(sinVale.voucherIssued).toBeNull();
  });
});
