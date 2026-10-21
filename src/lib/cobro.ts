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
