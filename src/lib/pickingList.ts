// Lista de preparación de los pedidos online: qué hay que coger del almacén (artículo, talla,
// SKU, código y cantidad, sumando todos los pedidos) y, debajo, qué lleva cada pedido.
// La ubicación es siempre la tienda: el hueco de estantería no existe en ningún sistema.

export interface PickingLine {
  title: string;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
}

export interface PickingOrder {
  name: string;
  customer: string | null;
  city: string | null;
  lines: PickingLine[];
}

export interface PickingRow extends PickingLine {
  /** Pedidos que llevan este artículo. */
  orders: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').trim();

/** Suma las líneas de todos los pedidos por artículo (SKU, o nombre y talla si no hay SKU). */
export function groupPickingLines(orders: PickingOrder[]): PickingRow[] {
  const rows = new Map<string, PickingRow>();
  for (const order of orders) {
    for (const line of order.lines) {
      if (!(line.quantity > 0)) continue;
      const key = norm(line.sku) ? `sku:${norm(line.sku).toLowerCase()}` : `t:${norm(line.title)}|${norm(line.size)}`;
      const row = rows.get(key);
      if (row) {
        row.quantity += line.quantity;
        if (!row.orders.includes(order.name)) row.orders.push(order.name);
      } else {
        rows.set(key, { ...line, orders: [order.name] });
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      norm(a.title).localeCompare(norm(b.title), 'es') ||
      norm(a.size).localeCompare(norm(b.size), 'es', { numeric: true }),
  );
}

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** HTML de la lista (A4). */
export function renderPickingList(orders: PickingOrder[], printedAt: Date = new Date()): string {
  const rows = groupPickingLines(orders);
  const units = rows.reduce((n, r) => n + r.quantity, 0);
  const date = printedAt.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const articleRows = rows
    .map(
      (r) => `<tr><td class="q">${esc(r.quantity)}</td><td>${esc(r.title)}</td><td>${esc(r.size)}</td>` +
        `<td>${esc(r.sku)}</td><td>${esc(r.barcode)}</td><td class="small">${esc(r.orders.join(', '))}</td><td class="box"></td></tr>`,
    )
    .join('');
  const orderBlocks = orders
    .map(
      (o) => `<div class="order"><strong>${esc(o.name)}</strong> · ${esc(o.customer)}${o.city ? ` · ${esc(o.city)}` : ''}<ul>` +
        o.lines
          .filter((l) => l.quantity > 0)
          .map((l) => `<li>${esc(l.quantity)} × ${esc(l.title)}${l.size ? ` · ${esc(l.size)}` : ''}${l.sku ? ` <span class="small">(${esc(l.sku)})</span>` : ''}</li>`)
          .join('') +
        '</ul></div>',
    )
    .join('');
  return `<h1>Lista de preparación</h1>
<p class="small">${esc(date)} · ${esc(orders.length)} pedidos · ${esc(units)} unidades · Tienda Valencia</p>
<table><thead><tr><th>Uds.</th><th>Artículo</th><th>Talla</th><th>SKU</th><th>Código</th><th>Pedidos</th><th>✓</th></tr></thead>
<tbody>${articleRows}</tbody></table>
<h2>Por pedido</h2>${orderBlocks}`;
}

const STYLES = `
  body { font-family: system-ui, sans-serif; font-size: 11pt; margin: 12mm; color: #000; }
  h1 { font-size: 16pt; margin: 0 0 2mm; } h2 { font-size: 13pt; margin: 8mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; } td.q { font-weight: 700; text-align: center; width: 10mm; } td.box { width: 8mm; }
  .small { font-size: 9pt; color: #444; } .order { margin: 0 0 3mm; break-inside: avoid; } ul { margin: 1mm 0 0 5mm; padding: 0; }
  @page { size: A4; margin: 0; }`;

/** Imprime la lista en un iframe oculto, como el ticket. */
export function printPickingList(orders: PickingOrder[]) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lista de preparación</title><style>${STYLES}</style></head><body>${renderPickingList(orders)}</body></html>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(html);
  d.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 50);
}
