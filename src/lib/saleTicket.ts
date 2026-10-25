// Ticket de una venta ya guardada, para reimprimirlo desde el historial. Sale igual que el
// del TPV en el momento de cobrar (SaleTicketDialog → toTicketDoc).
import type { TicketDoc } from '@/lib/ticket';
import { normalizeSearch } from '@/lib/search';

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

export interface StoredStockagileSaleRow {
  number: string | null;
  sold_at: string;
  total: number | string;
  is_return: boolean;
  payment_methods: string | null;
  customer_name: string | null;
  clients: { name: string | null } | null;
  stockagile_sale_items: {
    product_name: string;
    quantity: number | string;
    unit_price: number | string | null;
    total: number | string | null;
  }[];
}

export const STOCKAGILE_DUPLICATE_LABEL = 'DUPLICADO · Ticket de Stockagile';

const STOCKAGILE_PAYMENTS: Record<string, string> = { metalico: 'Efectivo', tarjeta: 'Tarjeta' };

/** «Metálico · Tarjeta» de Stockagile → «Efectivo · Tarjeta», como en los tickets de PYMOVA. */
export function stockagilePaymentLabel(methods: string | null): string | undefined {
  const parts = (methods ?? '')
    .split(/[·,/]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => STOCKAGILE_PAYMENTS[normalizeSearch(p)] ?? p);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Ticket de Stockagile copiado en PYMOVA (0046) → duplicado para reimprimir. Una devolución
 * (importe ≤ 0) sale como abono; un cambio, como venta con las líneas devueltas en negativo.
 */
export function stockagileTicketDoc(
  row: StoredStockagileSaleRow,
  taxRate: number,
  originalNumber: string | null = null,
): TicketDoc {
  const total = Number(row.total);
  const refund = row.is_return && total <= 0;
  return {
    kind: refund ? 'refund' : 'sale',
    number: row.number ?? '—',
    createdAt: new Date(row.sold_at),
    taxRate,
    total: Math.abs(total),
    paymentMethod: stockagilePaymentLabel(row.payment_methods),
    clientName: row.clients?.name ?? row.customer_name ?? null,
    originalNumber: row.is_return ? originalNumber : null,
    duplicateLabel: STOCKAGILE_DUPLICATE_LABEL,
    lines: row.stockagile_sale_items.map((i) => {
      const quantity = Number(i.quantity);
      const lineTotal = i.total != null ? Number(i.total) : round2(quantity * Number(i.unit_price ?? 0));
      const unitPrice = i.unit_price != null ? Number(i.unit_price) : quantity ? Math.abs(lineTotal / quantity) : 0;
      // En un abono todo va en positivo (el ticket ya le pone el signo); en un cambio, con su signo.
      const q = refund ? Math.abs(quantity) : quantity;
      const t = refund ? Math.abs(lineTotal) : lineTotal;
      return {
        name: i.product_name,
        quantity: q,
        unitPrice,
        total: t,
        discount: q > 0 ? Math.max(0, round2(q * unitPrice - t)) : 0,
      };
    }),
  };
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
