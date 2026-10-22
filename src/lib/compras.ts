// Compras a proveedor (0040): cálculos de la pantalla y recepción escaneando.
// Las mismas reglas las comprueba receive_purchase_order en el servidor.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: 'Borrador',
  ordered: 'Pedida',
  partial: 'Recibida en parte',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

export interface PurchaseItem {
  id: string;
  variant_id: string | null;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
  discount_pct: number;
}

/** Coste por unidad con el descuento aplicado (el que pasa a ser el coste del artículo). */
export function netUnitCost(unitCost: number, discountPct: number): number {
  return round2(Number(unitCost || 0) * (1 - Number(discountPct || 0) / 100));
}

/** Unidades pedidas, recibidas y coste total (neto) de una compra. */
export function purchaseTotals(items: Pick<PurchaseItem, 'qty_ordered' | 'qty_received' | 'unit_cost' | 'discount_pct'>[]) {
  return items.reduce(
    (acc, i) => ({
      ordered: acc.ordered + i.qty_ordered,
      received: acc.received + i.qty_received,
      cost: round2(acc.cost + i.qty_ordered * netUnitCost(i.unit_cost, i.discount_pct)),
    }),
    { ordered: 0, received: 0, cost: 0 },
  );
}

export const pendingOf = (i: Pick<PurchaseItem, 'qty_ordered' | 'qty_received'>) => Math.max(0, i.qty_ordered - i.qty_received);

export type ScanResult =
  | { ok: true; itemId: string; name: string; counts: Record<string, number> }
  | { ok: false; error: string };

/**
 * Un escaneo en la recepción: suma una unidad a la línea cuyo código de barras o SKU coincide,
 * sin pasar de lo pendiente.
 */
export function scanForReceipt(items: PurchaseItem[], counts: Record<string, number>, code: string): ScanResult {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return { ok: false, error: 'Escanea o escribe un código' };
  const item = items.find(
    (i) => i.barcode?.trim().toLowerCase() === wanted || i.sku?.trim().toLowerCase() === wanted,
  );
  if (!item) return { ok: false, error: `El código ${code.trim()} no está en esta compra` };
  const now = counts[item.id] ?? 0;
  if (now + 1 > pendingOf(item)) {
    return { ok: false, error: `De ${item.product_name} ya están todas (${item.qty_ordered} pedidas)` };
  }
  return { ok: true, itemId: item.id, name: item.product_name, counts: { ...counts, [item.id]: now + 1 } };
}

/** Líneas para receive_purchase_order: solo las que tienen unidades, sin pasar de lo pendiente. */
export function receiptLines(items: PurchaseItem[], counts: Record<string, number>) {
  return items
    .map((i) => ({ item_id: i.id, quantity: Math.min(Math.max(0, Math.floor(counts[i.id] ?? 0)), pendingOf(i)) }))
    .filter((l) => l.quantity > 0);
}
