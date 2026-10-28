// Motivos de un ajuste manual de stock. El texto final se guarda en el historial.

export const STOCK_ADJUST_REASONS = ['Recuento', 'Entrada de mercancía', 'Rotura o defecto', 'Otro'] as const;

/** Motivo + nota → texto para adjust_stock. «Otro» exige nota. Devuelve null si falta. */
export function buildAdjustReason(reason: string, note: string): string | null {
  const cleanNote = note.trim();
  if (reason === 'Otro') return cleanNote.length >= 3 ? cleanNote : null;
  return cleanNote ? `${reason}: ${cleanNote}` : reason;
}

/** Una línea para adjust_stock_batch (0057): el stock que se vio y el nuevo. */
export interface StockLine {
  variant_id: string | null;
  expected: number;
  new_quantity: number;
}

export interface StockGridRow {
  /** Null en un producto sin tallas. */
  variantId: string | null;
  name: string;
  current: number;
}

/** «set»: se escribe el stock nuevo. «add»: lo que entra (o sale, con signo menos). */
export type StockGridMode = 'set' | 'add';

export const stockRowKey = (row: Pick<StockGridRow, 'variantId'>) => row.variantId ?? 'producto';

/**
 * Lo escrito en la rejilla → líneas para guardar. Una casilla en blanco no cambia nada, y una
 * línea que deja el mismo stock tampoco se manda. Devuelve el primer error que encuentre.
 */
export function buildStockLines(
  rows: StockGridRow[],
  inputs: Record<string, string>,
  mode: StockGridMode,
): { lines: StockLine[]; error: string | null } {
  const lines: StockLine[] = [];
  for (const row of rows) {
    const raw = (inputs[stockRowKey(row)] ?? '').trim().replace(/^\+/, '');
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      return { lines: [], error: `${row.name}: escribe un número entero` };
    }
    const next = mode === 'add' ? row.current + value : value;
    if (next < 0) {
      return {
        lines: [],
        error: mode === 'add' ? `${row.name}: solo hay ${row.current}, no se pueden quitar ${-value}` : `${row.name}: el stock no puede ser negativo`,
      };
    }
    if (next !== row.current) lines.push({ variant_id: row.variantId, expected: row.current, new_quantity: next });
  }
  return { lines, error: null };
}
