// Ticket de una venta ya guardada, para reimprimirlo desde el historial. Sale igual que el
// del TPV en el momento de cobrar (SaleTicketDialog → toTicketDoc).
import type { TicketDoc } from '@/lib/ticket';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StoredSaleRow {
  sale_number: string;
  created_at: string;
  payment_method: string | null;
  total: number | string;
  tip: number | string | null;
  cash_received: number | string | null;
  change_given: number | string | null;
  notes: string | null;
  voucher_amount: number | string | null;
  clients: { name: string | null } | null;
  store_vouchers: { code: string } | null;
  sale_items: { product_name: string; quantity: number | string; unit_price: number | string; total: number | string | null }[];
}

/** Venta leída de la base de datos → ticket. */
export function saleTicketDoc(row: StoredSaleRow, taxRate: number, cashier: string | null): TicketDoc {
  const voucherAmount = Number(row.voucher_amount ?? 0);
  return {
    kind: 'sale',
    number: row.sale_number,
    createdAt: new Date(row.created_at),
    taxRate,
    // Como en el TPV: lo que se pagó aparte del vale, sin la propina.
    total: round2(Number(row.total) - voucherAmount),
    tip: Number(row.tip ?? 0),
    paymentMethod: row.payment_method ?? undefined,
    cashReceived: row.cash_received != null ? Number(row.cash_received) : null,
    change: row.change_given != null ? Number(row.change_given) : null,
    notes: row.notes,
    cashier,
    clientName: row.clients?.name ?? null,
    voucherPaid:
      voucherAmount > 0 && row.store_vouchers
        ? { code: row.store_vouchers.code, amount: voucherAmount, balanceLeft: null }
        : null,
    lines: row.sale_items.map((i) => {
      const quantity = Number(i.quantity);
      const unitPrice = Number(i.unit_price);
      const total = i.total != null ? Number(i.total) : round2(quantity * unitPrice);
      return {
        name: i.product_name,
        quantity,
        unitPrice,
        total,
        discount: Math.max(0, round2(quantity * unitPrice - total)),
      };
    }),
  };
}
