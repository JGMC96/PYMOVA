// Renderizado de tickets térmicos (factura simplificada) para el TPV.
import { round2, taxBreakdown } from './tax';
import { code128Svg } from './barcode';

export type PaperWidth = '80' | '58';

export interface TerminalTicketPrefs {
  paperWidth: PaperWidth;
  autoPrint: boolean;
  feedLines: number;
  copies: number;
}

const PREFS_KEY = 'pymova_ticket_terminal_prefs';
export const DEFAULT_PREFS: TerminalTicketPrefs = { paperWidth: '80', autoPrint: false, feedLines: 3, copies: 1 };

export function loadTerminalPrefs(): TerminalTicketPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveTerminalPrefs(p: TerminalTicketPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export interface TicketBusiness {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;
  showLogo?: boolean;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  header?: string | null;
  footer?: string | null;
  returnPolicy?: string | null;
  fontSize?: TicketFontSize;
  lineSpacing?: TicketLineSpacing;
  boldItems?: boolean;
}

export type TicketFontSize = 'small' | 'normal' | 'large' | 'xlarge';
export type TicketLineSpacing = 'compact' | 'normal' | 'relaxed';
export const FONT_SCALE: Record<TicketFontSize, number> = { small: 0.9, normal: 1, large: 1.2, xlarge: 1.4 };
export const LINE_HEIGHT: Record<TicketLineSpacing, number> = { compact: 1.15, normal: 1.35, relaxed: 1.6 };

export interface TicketLine {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Total de la línea ya con descuento */
  total: number;
  /** Importe descontado en la línea */
  discount?: number;
}

export interface TicketDoc {
  kind: 'sale' | 'refund' | 'test';
  number: string;
  createdAt: Date;
  lines: TicketLine[];
  taxRate: number;
  /** Total con IVA (sin propina) */
  total: number;
  tip?: number;
  paymentMethod?: string;
  cashReceived?: number | null;
  change?: number | null;
  notes?: string | null;
  cashier?: string | null;
  /** Abono: número de la venta que rectifica. */
  originalNumber?: string | null;
  /** Cliente de la venta, si se eligió en el TPV. */
  clientName?: string | null;
  /** Venta: parte pagada con un vale de tienda (el resto, con paymentMethod). */
  voucherPaid?: { code: string; amount: number; balanceLeft?: number | null } | null;
  /** Abono: vale de tienda creado con lo devuelto. */
  voucherIssued?: { code: string; amount: number; expiresAt: Date | null } | null;
}

export const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  bizum: 'Bizum',
  store_credit: 'Vale',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const eur = (n: number) =>
  `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
// El desglose vive en lib/tax.ts; se reexporta para no romper importaciones.
export { taxBreakdown };

/** Código de barras del número de ticket (vacío si no se puede codificar). */
const ticketBarcode = (number: string) => {
  try {
    return `<div class="barcode">${code128Svg(number)}</div>`;
  } catch {
    return '';
  }
};

/** Vale creado en un abono: código con su código de barras, importe y caducidad. */
const voucherBlock = (v: NonNullable<TicketDoc['voucherIssued']>) => {
  const until = v.expiresAt
    ? v.expiresAt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;
  return `<hr/><div class="center bold">VALE DE TIENDA</div>
  ${ticketBarcode(v.code)}
  <div class="center ref">${esc(v.code)}</div>
  <div class="row"><span>Importe</span><span class="bold">${eur(v.amount)}</span></div>
  ${until ? `<div class="row"><span>Válido hasta</span><span>${until}</span></div>` : ''}
  <div class="center small">Canjeable solo en tienda</div>`;
};

const multiline = (s?: string | null) =>
  s ? s.split('\n').map((l) => `<div>${esc(l)}</div>`).join('') : '';

/** HTML interno del ticket (sin <html>), usado en vista previa e impresión. */
export function renderTicketBody(biz: TicketBusiness, doc: TicketDoc): string {
  const sign = doc.kind === 'refund' ? -1 : 1;
  const { base, tax } = taxBreakdown(doc.total, doc.taxRate);
  const title =
    doc.kind === 'refund' ? 'TICKET DE ABONO' : doc.kind === 'test' ? 'TICKET DE PRUEBA' : 'FACTURA SIMPLIFICADA';
  const date = doc.createdAt.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const lines = doc.lines
    .map((l) => {
      const disc = l.discount && l.discount > 0
        ? `<div class="row muted"><span>&nbsp;&nbsp;Descuento</span><span>-${eur(l.discount)}</span></div>`
        : '';
      return `<div class="item"><div class="iname">${esc(l.name)}</div>
        <div class="row"><span>${l.quantity} x ${eur(l.unitPrice)}</span><span>${eur(sign * l.total)}</span></div>${disc}</div>`;
    })
    .join('');

  const tip = doc.tip && doc.tip > 0 ? doc.tip : 0;
  const grand = round2(doc.total + tip);

  return `
  <div class="center">
    ${biz.showLogo && biz.logoUrl ? `<img class="logo" src="${esc(biz.logoUrl)}" alt="" />` : ''}
    <div class="xl bold">${esc(biz.name)}</div>
    ${biz.legalName ? `<div>${esc(biz.legalName)}</div>` : ''}
    ${biz.taxId ? `<div>NIF: ${esc(biz.taxId)}</div>` : ''}
    ${multiline(biz.address)}
    ${biz.phone ? `<div>Tel. ${esc(biz.phone)}</div>` : ''}
    ${biz.website ? `<div>${esc(biz.website)}</div>` : ''}
    ${biz.header ? `<div class="sp">${multiline(biz.header)}</div>` : ''}
  </div>
  <hr/>
  <div class="center bold">${title}</div>
  <div class="row"><span>Nº</span><span class="bold">${esc(doc.number)}</span></div>
  <div class="row"><span>Fecha</span><span>${date}</span></div>
  ${doc.originalNumber ? `<div class="row"><span>Rectifica</span><span>${esc(doc.originalNumber)}</span></div>` : ''}
  ${doc.clientName ? `<div class="row"><span>Cliente</span><span>${esc(doc.clientName)}</span></div>` : ''}
  ${doc.cashier ? `<div class="row"><span>Atendido por</span><span>${esc(doc.cashier)}</span></div>` : ''}
  <hr/>
  ${lines}
  <hr/>
  <div class="row"><span>Base imponible</span><span>${eur(sign * base)}</span></div>
  <div class="row"><span>IVA ${doc.taxRate}%</span><span>${eur(sign * tax)}</span></div>
  ${tip ? `<div class="row"><span>Propina</span><span>${eur(tip)}</span></div>` : ''}
  <div class="row xl bold total"><span>TOTAL</span><span>${eur(sign * grand)}</span></div>
  ${doc.voucherPaid ? `<div class="row"><span>Vale ${esc(doc.voucherPaid.code)}</span><span>${eur(doc.voucherPaid.amount)}</span></div>` : ''}
  ${doc.voucherPaid && doc.voucherPaid.balanceLeft != null ? `<div class="row muted"><span>&nbsp;&nbsp;Saldo que queda</span><span>${eur(doc.voucherPaid.balanceLeft)}</span></div>` : ''}
  ${doc.paymentMethod && !(doc.voucherPaid && doc.paymentMethod === 'store_credit') ? `<div class="row"><span>${doc.kind === 'refund' ? 'Reembolso' : 'Pago'}</span><span>${esc(paymentLabels[doc.paymentMethod] ?? doc.paymentMethod)}</span></div>` : ''}
  ${doc.cashReceived != null ? `<div class="row"><span>Entregado</span><span>${eur(doc.cashReceived)}</span></div>` : ''}
  ${doc.change != null && doc.change > 0 ? `<div class="row"><span>Cambio</span><span>${eur(doc.change)}</span></div>` : ''}
  <div class="muted small">IVA incluido</div>
  ${doc.voucherIssued ? voucherBlock(doc.voucherIssued) : ''}
  ${doc.notes ? `<hr/><div class="small">${multiline(doc.notes)}</div>` : ''}
  <hr/>
  ${ticketBarcode(doc.number)}
  <div class="center ref">${esc(doc.number)}</div>
  ${biz.returnPolicy ? `<div class="center small sp">${multiline(biz.returnPolicy)}</div>` : ''}
  <div class="center sp">${multiline(biz.footer || '¡Gracias por su compra!')}</div>`;
}

export function ticketStyles(width: PaperWidth, feedLines: number, style: Pick<TicketBusiness, 'fontSize' | 'lineSpacing' | 'boldItems'> = {}) {
  const base = (width === '58' ? 10 : 12) * FONT_SCALE[style.fontSize ?? 'normal'];
  const lh = LINE_HEIGHT[style.lineSpacing ?? 'normal'];
  const mm = width === '58' ? 48 : 72; // área imprimible real
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  @page{size:${width}mm auto;margin:0}
  html,body{background:#fff;color:#000}
  body{font-family:'Courier New',ui-monospace,monospace;font-size:${base}px;line-height:${lh}}
  .iname{font-weight:${style.boldItems === false ? 400 : 700}}
  .ticket{width:${mm}mm;margin:0 auto;padding:3mm 0 ${feedLines * 5}mm}
  .center{text-align:center}.bold{font-weight:700}.xl{font-size:1.3em}.small{font-size:.85em}
  .muted{opacity:.75}.sp{margin-top:4px}
  .row{display:flex;justify-content:space-between;gap:6px}
  .item{margin-bottom:3px}
  .total{margin:4px 0;padding:2px 0;border-top:1px solid #000;border-bottom:1px solid #000}
  .ref{font-size:1.1em;letter-spacing:2px;font-weight:700}
  .barcode svg{display:block;margin:2px auto 1px;width:${Math.min(mm, 60)}mm;height:12mm}
  .logo{max-width:60%;max-height:20mm;margin:0 auto 4px;display:block;filter:grayscale(1)}
  hr{border:none;border-top:1px dashed #000;margin:5px 0}`;
}

/** Imprime el ticket en un iframe oculto (sin ventanas emergentes). */
export function printTicket(biz: TicketBusiness, doc: TicketDoc, prefs: TerminalTicketPrefs) {
  const body = renderTicketBody(biz, doc);
  const copies = Math.max(1, Math.min(prefs.copies, 3));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
    <style>${ticketStyles(prefs.paperWidth, prefs.feedLines, biz)} .ticket+.ticket{page-break-before:always}</style></head>
    <body>${Array.from({ length: copies }, () => `<div class="ticket">${body}</div>`).join('')}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(html);
  d.close();
  const go = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  const imgs = Array.from(d.images);
  if (imgs.length === 0) setTimeout(go, 50);
  else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(go);
}
