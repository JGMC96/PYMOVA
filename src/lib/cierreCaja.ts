// Cierre de caja guiado: las cuentas del asistente (qué debería haber en el cajón, lo contado,
// lo que se retira y lo que se deja para mañana). Sin cambios en el servidor: el cierre sigue
// siendo close_register_session y la retirada, una «Retirada al banco» (create_cash_movement, 0059).
import { parseAmount } from './lineDiscount';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Billetes y monedas en euros, de mayor a menor. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;

export const denominationLabel = (d: number) =>
  d >= 1 ? `${d} €` : `${Math.round(d * 100)} cént.`;

/** Total de un recuento por billetes y monedas: { '50': 2, '0.2': 3 } → 100,60. */
export function countTotal(counts: Record<string, string | number | undefined>): number {
  return round2(
    DENOMINATIONS.reduce((sum, d) => {
      const n = Math.trunc(Number(String(counts[String(d)] ?? '').trim() || 0));
      return sum + (Number.isFinite(n) && n > 0 ? n * d : 0);
    }, 0),
  );
}

/** Importe de efectivo escrito a mano (coma o punto); 0 vale. null si no es válido. */
export function parseCash(raw: string): number | null {
  const value = parseAmount(raw);
  if (value === null || value < 0 || value > 9999999) return null;
  return round2(value);
}

export interface ExpectedLine {
  label: string;
  amount: number;
}

/**
 * Por qué hay que tener ese efectivo en el cajón, línea a línea, con signo. El total es el mismo
 * que calcula el servidor (register_expected_cash): fondo + ventas en efectivo − devoluciones en
 * efectivo + entradas − gastos − retiradas.
 */
export function expectedBreakdown(p: {
  opening: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  expenses: number;
  withdrawals: number;
}): { lines: ExpectedLine[]; total: number } {
  const all: ExpectedLine[] = [
    { label: 'Fondo al abrir', amount: round2(p.opening) },
    { label: 'Ventas en efectivo', amount: round2(p.cashSales) },
    { label: 'Devoluciones en efectivo', amount: -round2(p.cashRefunds) },
    { label: 'Entradas de cambio', amount: round2(p.cashIn) },
    { label: 'Gastos pagados de la caja', amount: -round2(p.expenses) },
    { label: 'Retiradas al banco', amount: -round2(p.withdrawals) },
  ];
  // El fondo siempre se ve; el resto, solo si hubo algo.
  const lines = all.filter((l, i) => i === 0 || Math.abs(l.amount) >= 0.005);
  return { lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
}

/** Diferencia entre lo contado y lo esperado, dicha como en la tienda. */
export function cashOutcome(counted: number, expected: number): { difference: number; text: string; ok: boolean } {
  const difference = round2(counted - expected);
  if (Math.abs(difference) < 0.005) return { difference: 0, text: 'Cuadra', ok: true };
  const abs = Math.abs(difference).toFixed(2).replace('.', ',');
  return difference < 0
    ? { difference, text: `Faltan ${abs} €`, ok: false }
    : { difference, text: `Sobran ${abs} €`, ok: false };
}

export interface WithdrawalPlan {
  /** Lo que se apunta como «Retirada al banco» antes de cerrar. */
  withdrawal: number;
  /** Lo que queda en el cajón para mañana (lo que se guarda como contado al cerrar). */
  keep: number;
  /** true si la retirada se ha recortado a lo que el servidor deja sacar (el esperado). */
  capped: boolean;
  problem: string | null;
}

/**
 * Cuánto se retira al banco: lo contado menos lo que se deja para mañana. El servidor no deja
 * sacar más efectivo que el esperado; si sobra más que eso, el resto se queda en el cajón.
 * `expected` es null en arqueo a ciegas (no se sabe aquí).
 */
export function withdrawalPlan(counted: number, keepWanted: number, expected: number | null): WithdrawalPlan {
  if (!(counted >= 0)) return { withdrawal: 0, keep: 0, capped: false, problem: 'Cuenta primero el efectivo.' };
  if (!(keepWanted >= 0)) return { withdrawal: 0, keep: counted, capped: false, problem: 'Escribe cuánto dejas en caja (0 si no dejas nada).' };
  if (keepWanted > counted + 0.005) {
    return { withdrawal: 0, keep: counted, capped: false, problem: 'No puedes dejar más de lo que has contado.' };
  }
  let withdrawal = round2(counted - keepWanted);
  let capped = false;
  if (expected !== null && withdrawal > expected) {
    withdrawal = round2(Math.max(expected, 0));
    capped = true;
  }
  return { withdrawal, keep: round2(counted - withdrawal), capped, problem: null };
}

/** Fondo que se propone al abrir: lo que quedó en el cajón en el último cierre. */
export function suggestedOpening(lastClosed: { counted_amount: number | null } | null | undefined): number | null {
  const v = lastClosed?.counted_amount;
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : round2(Number(v));
}

/** Motivo con el que el asistente apunta la retirada al cerrar: así se reconoce al reimprimir. */
export const CLOSING_WITHDRAWAL_REASON = 'Retirada al cerrar la caja';

/**
 * Ticket de un cierre ya hecho (reimpresión desde «Historial de cierres»), con lo guardado: la
 * caja cerrada, su resumen por forma de pago (get_register_summary) y sus movimientos
 * (get_cash_movements). La retirada del cierre es la última «Retirada al banco» con el motivo
 * del asistente; el servidor guardó esperado y contado ya sin ella. El total del datáfono no se
 * guarda: no sale. Un cierre anterior al asistente no tiene retirada: lo contado es lo que quedó.
 */
export function closingDocFromHistory(p: {
  session: {
    opened_at: string;
    closed_at: string | null;
    opening_amount: number | string | null;
    expected_amount: number | string | null;
    counted_amount: number | string | null;
    difference: number | string | null;
    notes: string | null;
    opened_by_employee_id?: string | null;
    closed_by_employee_id?: string | null;
  };
  summary: { payment_method: string; sales_count: number | string; total_amount: number | string | null; refunds_amount: number | string | null }[];
  movements: { movement_type: string; amount: number | string; reason: string; created_at: string; voided_at: string | null }[];
  personName: (id: string | null | undefined) => string | null;
  labels: Record<string, string>;
}): ClosingDoc {
  const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  const live = p.movements.filter((m) => !m.voided_at);
  const closing = live
    .filter((m) => m.movement_type === 'withdrawal' && m.reason === CLOSING_WITHDRAWAL_REASON)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .pop();
  const sum = (type: string) => round2(live
    .filter((m) => m.movement_type === type && m !== closing)
    .reduce((s, m) => s + Number(m.amount), 0));
  const withdrawal = closing ? round2(Number(closing.amount)) : 0;
  const counted = num(p.session.counted_amount) ?? 0;
  const expected = num(p.session.expected_amount);
  const cashRow = p.summary.find((r) => r.payment_method === 'cash');
  return {
    openedAt: p.session.opened_at,
    closedAt: p.session.closed_at ?? p.session.opened_at,
    openedBy: p.personName(p.session.opened_by_employee_id),
    closedBy: p.personName(p.session.closed_by_employee_id),
    opening: round2(num(p.session.opening_amount) ?? 0),
    payments: p.summary
      .filter((r) => Number(r.sales_count) > 0)
      .map((r) => ({
        method: r.payment_method,
        label: p.labels[r.payment_method] ?? r.payment_method,
        count: Number(r.sales_count),
        amount: num(r.total_amount),
      })),
    cashRefunds: num(cashRow?.refunds_amount) ?? 0,
    cashIn: sum('cash_in'),
    expenses: sum('expense'),
    withdrawalsBefore: sum('withdrawal'),
    expected: expected === null ? null : round2(expected + withdrawal),
    countedTotal: round2(counted + withdrawal),
    difference: num(p.session.difference),
    withdrawal,
    keep: round2(counted),
    cardTerminal: null,
    notes: p.session.notes,
  };
}

/** Datos del resumen de un cierre (pantalla final e impresión). */
export interface ClosingDoc {
  openedAt: string;
  closedAt: string;
  openedBy: string | null;
  closedBy: string | null;
  opening: number;
  /** Ventas por forma de pago; importe null en arqueo a ciegas. */
  payments: { method: string; label: string; count: number; amount: number | null }[];
  cashRefunds: number | null;
  cashIn: number | null;
  expenses: number | null;
  withdrawalsBefore: number | null;
  expected: number | null;
  countedTotal: number;
  difference: number | null;
  withdrawal: number;
  keep: number;
  cardTerminal: number | null;
  notes: string | null;
}
