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
});
