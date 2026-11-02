import { describe, expect, it } from 'vitest';
import { giftTicketDoc, renderTicketBody, type TicketBusiness, type TicketDoc } from '@/lib/ticket';

const biz: TicketBusiness = { name: 'Tienda', address: 'Calle Mayor 1', showLogo: false };
const sale: TicketDoc = {
  kind: 'sale',
  number: 'V-0042',
  createdAt: new Date(2026, 10, 2, 12, 30),
  taxRate: 21,
  total: 214.1,
  tip: 3,
  paymentMethod: 'cash',
  cashReceived: 220,
  change: 5.9,
  notes: 'Nota interna',
  cashier: 'Lucía',
  clientName: 'Marta Compradora',
  voucherPaid: { code: 'VALE-7', amount: 10, balanceLeft: 2 },
  duplicateLabel: 'DUPLICADO',
  lines: [
    { name: 'Botín Sorolla · T40', quantity: 1, unitPrice: 179, total: 179 },
    { name: 'Crema <nutritiva>', quantity: 2, unitPrice: 19.5, total: 35.1, discount: 3.9 },
  ],
};

const gift = (b: TicketBusiness = biz) => renderTicketBody(b, giftTicketDoc(sale));
/** El texto del ticket, sin el dibujo del código de barras (lleva números que no son importes). */
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '');

describe('ticket regalo', () => {
  it('lleva el título, el número, la fecha y los artículos con su cantidad', () => {
    const html = gift();
    expect(html).toContain('TICKET REGALO');
    expect(html).toContain('V-0042');
    expect(html).toContain('02/11/2026');
    expect(html).toContain('Botín Sorolla · T40');
    expect(html).toContain('Crema &lt;nutritiva&gt;');
    expect(html).toContain('Cantidad: 2');
  });

  it('lleva el código de barras del número, para poder hacer el cambio', () => {
    expect(gift()).toContain('<svg');
    expect(gift()).toContain('class="center ref">V-0042');
  });

  it('no lleva precios, total, impuestos ni nada de cobro', () => {
    const html = text(gift());
    expect(html).not.toContain('€');
    for (const hidden of [
      '179', '19,5', '35,1', '3,9', '214', 'TOTAL', 'IVA', 'Base imponible', 'Descuento', 'Propina',
      'Pago', 'Efectivo', 'Entregado', 'Cambio', 'Vale', 'VALE-7', 'FACTURA',
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  it('no lleva quién compró, quién atendió, notas ni la marca de duplicado', () => {
    const html = gift();
    for (const hidden of ['Marta', 'Lucía', 'Nota interna', 'DUPLICADO']) {
      expect(html).not.toContain(hidden);
    }
  });

  it('el documento ya no guarda esos datos', () => {
    const doc = giftTicketDoc(sale);
    expect(doc).toMatchObject({ kind: 'gift', number: 'V-0042', total: 0, taxRate: 0 });
    expect(doc.lines[1]).toEqual({ name: 'Crema <nutritiva>', quantity: 2, unitPrice: 0, total: 0 });
    for (const key of ['tip', 'paymentMethod', 'cashReceived', 'change', 'notes', 'cashier', 'clientName', 'voucherPaid', 'duplicateLabel']) {
      expect(doc).not.toHaveProperty(key);
    }
  });

  it('usa las condiciones de cambio de la tienda, y si no hay, un aviso genérico', () => {
    const policy = 'Cambios en 30 días';
    expect(gift({ ...biz, returnPolicy: policy })).toContain(policy);
    expect(gift({ ...biz, returnPolicy: policy })).not.toContain('presenta este ticket');
    expect(gift()).toContain('Para hacer un cambio, presenta este ticket.');
  });

  it('usa el pie de la tienda; sin él, no da las gracias por una compra que no hizo quien lo recibe', () => {
    expect(gift({ ...biz, footer: 'Hasta pronto' })).toContain('Hasta pronto');
    expect(gift()).toContain('¡Que lo disfrutes!');
    expect(gift()).not.toContain('Gracias por su compra');
  });

  it('el ticket normal sigue igual', () => {
    const html = renderTicketBody(biz, sale);
    expect(html).toContain('FACTURA SIMPLIFICADA');
    expect(html).toContain('TOTAL');
    expect(html).toContain('Marta Compradora');
    expect(html).toContain('Calle Mayor 1');
  });
});
