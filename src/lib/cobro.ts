// Ayudas del cobro en el TPV: importes rápidos de efectivo, cambio y caja abierta de otro día.

const round2 = (n: number) => Math.round(n * 100) / 100;

const BILLETES = [5, 10, 20, 50, 100, 200, 500];

/**
 * Importes rápidos para el efectivo entregado: el exacto y los siguientes billetes
 * redondos que cubren el total (como mucho 4 en total, sin repetir).
 * Ejemplo: 37,50 € → [37,50, 40, 50, 100].
 */
export function quickCashAmounts(due: number, max = 4): number[] {
  if (!(due > 0)) return [];
  const exact = round2(due);
  const out: number[] = [exact];
  for (const step of BILLETES) {
    const rounded = Math.ceil(exact / step) * step;
    if (rounded > exact && !out.includes(rounded)) out.push(rounded);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Cambio a devolver (negativo si falta dinero). `null` si no hay importe entregado. */
export function cashChange(received: string, due: number): number | null {
  const value = parseFloat(received.replace(',', '.'));
  if (isNaN(value)) return null;
  return round2(value - due);
}

/** Importe entregado como número, aceptando coma decimal. `null` si está vacío o no es válido. */
export function parseCash(received: string): number | null {
  const value = parseFloat(received.replace(',', '.'));
  return isNaN(value) ? null : round2(value);
}

export interface MixedSplit {
  /** Lo que se cobra con tarjeta (lo que marca el datáfono). */
  card: number;
  /** El resto, en efectivo: sobre esto se calcula el cambio. */
  cash: number;
  problem: string | null;
}

/**
 * Pago mixto (0065): se escribe la parte con tarjeta y el resto es efectivo. Las dos partes
 * tienen que ser mayores que 0 (si no, es un pago de una sola forma).
 */
export function mixedSplit(due: number, cardInput: string): MixedSplit {
  const total = round2(due);
  const raw = cardInput.trim();
  const card = raw ? parseCash(raw) : null;
  if (card === null) return { card: 0, cash: total, problem: 'Escribe cuánto se cobra con tarjeta.' };
  if (card <= 0) return { card, cash: total, problem: 'La parte con tarjeta tiene que ser mayor que 0.' };
  if (card >= total) {
    return { card, cash: 0, problem: `Con tarjeta tiene que ser menos de ${total.toFixed(2).replace('.', ',')} €: si es todo, elige «Tarjeta».` };
  }
  return { card, cash: round2(total - card), problem: null };
}

/** Las formas de pago que se mandan a create_sale_with_items (_payments) en un pago mixto. */
export function mixedPayments(split: MixedSplit): { method: 'card' | 'cash'; amount: number }[] {
  return [
    { method: 'card', amount: split.card },
    { method: 'cash', amount: split.cash },
  ];
}

/**
 * Devolución de una venta mixta: se propone devolver con la forma de pago que más pagó
 * (con empate, la tarjeta). null si no hay formas de pago.
 */
export function largestPaymentMethod(payments: { method: string; amount: number | string }[] | null | undefined): string | null {
  let best: { method: string; amount: number } | null = null;
  for (const p of payments ?? []) {
    const amount = Number(p.amount);
    if (!(amount > 0)) continue;
    if (!best || amount > best.amount || (amount === best.amount && p.method === 'card')) best = { method: p.method, amount };
  }
  return best?.method ?? null;
}

/** ¿La caja se abrió un día anterior al de hoy (hora local)? */
export function isOpenFromEarlierDay(openedAt: string | Date, now = new Date()): boolean {
  const opened = new Date(openedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return opened.getTime() < startOfToday.getTime();
}

/** «el lunes 19/10 a las 16:52» (hora local). */
export function describeOpenedAt(openedAt: string | Date): string {
  const d = new Date(openedAt);
  const dia = d.toLocaleDateString('es-ES', { weekday: 'long' });
  const fecha = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `el ${dia} ${fecha} a las ${hora}`;
}
