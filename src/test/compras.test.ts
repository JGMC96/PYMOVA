import { describe, expect, it } from 'vitest';
import { netUnitCost, purchaseTotals, receiptLines, scanForReceipt, type PurchaseItem } from '@/lib/compras';

const item = (id: string, over: Partial<PurchaseItem> = {}): PurchaseItem => ({
  id, variant_id: `v-${id}`, product_id: 'p', product_name: `Zueco · ${id}`, sku: `SKU${id}`, barcode: `B${id}`,
  qty_ordered: 2, qty_received: 0, unit_cost: 40, discount_pct: 0, ...over,
});

describe('compras', () => {
  it('coste neto con descuento y totales de la compra', () => {
    expect(netUnitCost(40, 10)).toBe(36);
    expect(netUnitCost(39.99, 0)).toBe(39.99);
    expect(purchaseTotals([item('38', { qty_ordered: 4, qty_received: 2, discount_pct: 10 }), item('39')]))
      .toEqual({ ordered: 6, received: 2, cost: 224 });
  });

  it('cada escaneo suma una unidad a su línea, por código de barras o SKU, sin pasar de lo pendiente', () => {
    const items = [item('38', { qty_received: 1 }), item('39')];
    let counts: Record<string, number> = {};
    const a = scanForReceipt(items, counts, ' b38 ');
    expect(a).toMatchObject({ ok: true, itemId: '38' });
    counts = a.ok ? a.counts : counts;
    expect(scanForReceipt(items, counts, 'B38')).toEqual({ ok: false, error: 'De Zueco · 38 ya están todas (2 pedidas)' });
    const b = scanForReceipt(items, counts, 'sku39');
    expect(b).toMatchObject({ ok: true, counts: { 38: 1, 39: 1 } });
    expect(scanForReceipt(items, counts, 'X1')).toEqual({ ok: false, error: 'El código X1 no está en esta compra' });
    expect(scanForReceipt(items, counts, '  ')).toEqual({ ok: false, error: 'Escanea o escribe un código' });
  });

  it('solo manda las líneas con unidades, sin pasar de lo pendiente', () => {
    const items = [item('38', { qty_received: 1 }), item('39'), item('40')];
    expect(receiptLines(items, { 38: 5, 39: 2, 40: 0 })).toEqual([
      { item_id: '38', quantity: 1 },
      { item_id: '39', quantity: 2 },
    ]);
  });
});
