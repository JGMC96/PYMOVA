// Devolver tickets de Stockagile desde PYMOVA (0060). El servidor calcula lo que queda y manda;
// esto solo prepara lo que se enseña y lo que se envía.
import { round2 } from './tax';

/** El mismo plazo que comprueba stockagile_return_blocked. */
export const RETURN_WINDOW_DAYS = 180;

export interface ReturnableLine {
  line_key: string;
  product_name: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  quantity: number;
  line_total: number;
  returned_stockagile: number;
  returned_pymova: number;
  /** Negativo si se ha devuelto de más entre los dos sistemas. */
  remaining: number;
  variant_id: string | null;
  /** 'code': enlazada por código. 'name': por nombre y talla; hay que confirmarla. */
  variant_match: 'code' | 'name' | null;
  variant_name: string | null;
}

export interface ReturnableTicket {
  number: string | null;
  sold_at: string;
  payment_methods: string | null;
  blocked: string | null;
  over_returned: boolean;
  lines: ReturnableLine[];
}

/** Talla elegida a mano para una línea (escaneando el par o buscándolo). */
export interface PickedVariant {
  id: string;
  label: string;
}

/** ¿Se ofrece el botón? Lo que no se ofrece aquí lo rechazaría el servidor. */
export function canOfferReturn(soldAt: string, lines: { quantity: number }[], now = new Date()): boolean {
  const limit = now.getTime() - RETURN_WINDOW_DAYS * 86_400_000;
  return new Date(soldAt).getTime() >= limit && lines.some((l) => Number(l.quantity) > 0);
}

/** Lo cobrado por las unidades a devolver, con el mismo redondeo que create_stockagile_return. */
export function lineRefund(line: ReturnableLine, qty: number): number {
  if (qty <= 0 || line.quantity <= 0) return 0;
  const unit = Number(line.line_total) / line.quantity;
  const already = line.returned_stockagile + line.returned_pymova;
  return round2(round2((already + qty) * unit) - round2(already * unit));
}

/** Método del ticket. Si fue con los dos, o no consta, no se sugiere nada. */
export function suggestedRefundMethod(paymentMethods: string | null): 'cash' | 'card' | null {
  const text = (paymentMethods ?? '').toLowerCase();
  const cash = /(metálico|metalico|efectivo|cash)/.test(text);
  const card = /(tarjeta|card)/.test(text);
  if (cash === card) return null;
  return cash ? 'cash' : 'card';
}

/** Talla a la que vuelve el par: la elegida a mano o, si es segura o confirmada, la del ticket. */
export function resolvedVariant(line: ReturnableLine, picked: PickedVariant | undefined, confirmed: boolean): string | null {
  if (picked) return picked.id;
  if (line.variant_match === 'code') return line.variant_id;
  if (line.variant_match === 'name' && confirmed) return line.variant_id;
  return null;
}

/** Lo que se envía a create_stockagile_return: solo las líneas con unidades. */
export function returnItems(
  lines: ReturnableLine[],
  quantities: Record<string, number>,
  picks: Record<string, PickedVariant>,
  confirmed: Record<string, boolean>,
) {
  return lines
    .filter((line) => (quantities[line.line_key] ?? 0) > 0)
    .map((line) => ({
      line_key: line.line_key,
      quantity: quantities[line.line_key],
      variant_id: resolvedVariant(line, picks[line.line_key], !!confirmed[line.line_key]),
    }));
}

/** Buscar por código o por nombre con la talla al final («bolonia negro 39»). */
export function parseVariantSearch(raw: string): { barcode: string } | { name: string; size: string | null } | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length < 2) return null;
  if (/^\d{8,14}$/.test(text)) return { barcode: text };
  const match = text.match(/^(.+?)\s+(\d{2}(?:[.,]5)?|\d{2}-\d{2})$/);
  return match ? { name: match[1], size: match[2] } : { name: text, size: null };
}
