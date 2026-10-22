// «Varios» en el TPV: línea libre para outlet o artículos que no están dados de alta.
// La descripción y el precio (IVA incluido) los escribe quien vende; no tiene stock.
import type { CartItem } from '@/hooks/useRetailSales';

export const VARIOS_PREFIX = 'Varios · ';
export const VARIOS_MAX_NAME = 120;
export const VARIOS_MAX_PRICE = 99999.99;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type VariosInput = { name: string; price: string; quantity: string };
export type VariosResult =
  | { ok: true; name: string; price: number; quantity: number }
  | { ok: false; error: string };

/** Valida lo escrito en la ventana de Varios (acepta coma decimal). Mismas reglas que la RPC. */
export function parseVarios(input: VariosInput): VariosResult {
  const name = input.name.trim().replace(/^Varios\s*·\s*/i, '').trim();
  if (!name) return { ok: false, error: 'Escribe qué se vende' };
  if (name.length > VARIOS_MAX_NAME) {
    return { ok: false, error: `La descripción no puede pasar de ${VARIOS_MAX_NAME} caracteres` };
  }
  const price = round2(parseFloat(input.price.trim().replace(',', '.')));
  if (isNaN(price) || price <= 0 || price > VARIOS_MAX_PRICE) {
    return { ok: false, error: 'Pon un precio entre 0,01 y 99.999,99 €' };
  }
  const quantity = Number(input.quantity.trim() || '1');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, error: 'Las unidades deben ser un número entero entre 1 y 999' };
  }
  return { ok: true, name, price, quantity };
}

/**
 * Línea del carrito para Varios. Cada una es distinta (no se juntan aunque coincidan):
 * su clave es local y no se envía; la venta la manda sin producto y con `custom`.
 */
export function variosCartItem(
  v: { name: string; price: number; quantity: number },
  id: string = crypto.randomUUID(),
): CartItem {
  return {
    product_id: `varios:${id}`,
    variant_id: null,
    custom: true,
    product_name: `${VARIOS_PREFIX}${v.name}`,
    quantity: v.quantity,
    unit_price: v.price,
    total: round2(v.price * v.quantity),
  };
}

/** ¿Lo escrito en el buscador del TPV es «Varios»? (sin tildes ni mayúsculas, desde 2 letras) */
export function matchesVarios(query: string): boolean {
  const q = query.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return q.length >= 2 && ('varios'.startsWith(q) || q.startsWith('varios'));
}
