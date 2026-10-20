// Datos del ticket por correo de una venta del TPV, calculados en el servidor a partir
// de la base de datos (nunca de lo que mande el navegador). Sin dependencias de Deno
// para poder probarlo con Vitest.
import { code128Runs } from './code128.ts'

export interface SaleReceiptSource {
  sale: {
    sale_number: string
    created_at: string
    payment_method: string | null
    subtotal: number | string
    tax: number | string
    total: number | string
    tip: number | string | null
    cash_received: number | string | null
    change_given: number | string | null
  }
  items: {
    product_name: string
    quantity: number | string
    unit_price: number | string
    total: number | string
  }[]
  business: {
    name: string
    trade_name: string | null
    legal_name: string | null
    tax_id: string | null
    currency: string | null
    timezone: string | null
  }
  settings: {
    tax_rate: number | string | null
    ticket_trade_name: string | null
    ticket_legal_name: string | null
    ticket_tax_id: string | null
    ticket_address: string | null
    ticket_phone: string | null
    ticket_website: string | null
    ticket_footer: string | null
    ticket_return_policy: string | null
  } | null
  clientName: string | null
  cashier: string | null
}

export interface SaleReceiptLine {
  name: string
  detail: string
  total: string
  discount: string | null
}

export interface SaleReceiptProps {
  businessName: string
  legalName: string | null
  taxId: string | null
  address: string | null
  phone: string | null
  website: string | null
  saleNumber: string
  date: string
  cashier: string | null
  clientName: string | null
  lines: SaleReceiptLine[]
  base: string
  taxLabel: string
  tax: string
  tip: string | null
  total: string
  payment: string | null
  cashReceived: string | null
  change: string | null
  returnPolicy: string | null
  footer: string
  barcode: { bar: boolean; width: number }[]
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  bizum: 'Bizum',
  store_credit: 'Vale',
}

const DEFAULT_TAX_RATE = 21

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100
const clean = (s: string | null | undefined) => {
  const t = (s ?? '').trim()
  return t ? t : null
}

export function buildSaleReceipt(src: SaleReceiptSource): SaleReceiptProps {
  const currency = src.business.currency || 'EUR'
  const money = (n: number) => {
    try {
      return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)
    } catch {
      return `${n.toFixed(2)} ${currency}`
    }
  }
  const timeZone = src.business.timezone || 'Europe/Madrid'
  const created = new Date(src.sale.created_at)
  let date: string
  try {
    date = created.toLocaleString('es-ES', {
      timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    date = created.toISOString()
  }

  const s = src.settings
  const rate = s?.tax_rate != null ? num(s.tax_rate) : DEFAULT_TAX_RATE
  const tip = round2(num(src.sale.tip))
  const total = round2(num(src.sale.total))
  const cashReceived = src.sale.cash_received != null ? num(src.sale.cash_received) : null
  const change = src.sale.change_given != null ? num(src.sale.change_given) : null

  let barcode: { bar: boolean; width: number }[] = []
  try {
    barcode = code128Runs(src.sale.sale_number)
  } catch {
    barcode = []
  }

  return {
    businessName: clean(s?.ticket_trade_name) ?? clean(src.business.trade_name) ?? src.business.name,
    legalName: clean(s?.ticket_legal_name) ?? clean(src.business.legal_name),
    taxId: clean(s?.ticket_tax_id) ?? clean(src.business.tax_id),
    address: clean(s?.ticket_address),
    phone: clean(s?.ticket_phone),
    website: clean(s?.ticket_website),
    saleNumber: src.sale.sale_number,
    date,
    cashier: clean(src.cashier),
    clientName: clean(src.clientName),
    lines: src.items.map((i) => {
      const quantity = num(i.quantity)
      const unit = num(i.unit_price)
      const lineTotal = round2(num(i.total))
      const discount = round2(quantity * unit - lineTotal)
      return {
        name: i.product_name,
        detail: `${quantity} x ${money(unit)}`,
        total: money(lineTotal),
        discount: discount > 0 ? `-${money(discount)}` : null,
      }
    }),
    base: money(round2(num(src.sale.subtotal))),
    taxLabel: `IVA ${rate.toLocaleString('es-ES')} %`,
    tax: money(round2(num(src.sale.tax))),
    tip: tip > 0 ? money(tip) : null,
    total: money(round2(total + tip)),
    payment: src.sale.payment_method
      ? PAYMENT_LABELS[src.sale.payment_method] ?? src.sale.payment_method
      : null,
    cashReceived: cashReceived != null ? money(cashReceived) : null,
    change: change != null && change > 0 ? money(change) : null,
    returnPolicy: clean(s?.ticket_return_policy),
    footer: clean(s?.ticket_footer) ?? '¡Gracias por su compra!',
    barcode,
  }
}

/** Envíos de un mismo ticket permitidos en 24 horas, para que no se use como buzón. */
export const SALE_RECEIPT_DAILY_LIMIT = 3
