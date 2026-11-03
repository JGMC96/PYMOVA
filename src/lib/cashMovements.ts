// Movimientos de caja (0059): gastos, entradas de cambio y retiradas al banco.
import { parseAmount } from './lineDiscount';

export type CashMovementType = 'expense' | 'cash_in' | 'withdrawal';

export const MOVEMENT_LABELS: Record<CashMovementType, string> = {
  expense: 'Gasto',
  cash_in: 'Entrada de cambio',
  withdrawal: 'Retirada al banco',
};

/** Las mismas que admite create_cash_movement. */
export const EXPENSE_CATEGORIES: Record<string, string> = {
  cleaning: 'Limpieza',
  drinks: 'Agua y bebidas',
  office: 'Material de oficina',
  courier: 'Mensajería',
  other: 'Otros',
};

export interface CashMovement {
  id: string;
  movement_type: CashMovementType;
  amount: number;
  category: string | null;
  reason: string;
  who: string | null;
  created_at: string;
  voided_at: string | null;
  voided_who: string | null;
  void_reason: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Totales de un turno, sin los anulados. `net` es lo que suman al efectivo esperado. */
export function movementTotals(movements: CashMovement[]) {
  const sum = (type: CashMovementType) =>
    round2(
      movements
        .filter((m) => m.movement_type === type && !m.voided_at)
        .reduce((total, m) => total + Number(m.amount), 0),
    );
  const cashIn = sum('cash_in');
  const expenses = sum('expense');
  const withdrawals = sum('withdrawal');
  return { cashIn, expenses, withdrawals, net: round2(cashIn - expenses - withdrawals) };
}

/** Importe escrito → número válido (positivo y con dos decimales como mucho), o null. */
export function parseMovementAmount(raw: string): number | null {
  const value = parseAmount(raw);
  if (value === null || value <= 0 || value > 9999999) return null;
  return round2(value) === value ? value : null;
}

/** Lo que falta para poder guardar, o null si está completo. Las mismas reglas que el servidor. */
export function movementProblem(type: CashMovementType, amount: string, category: string, reason: string): string | null {
  if (parseMovementAmount(amount) === null) return 'Escribe un importe mayor que cero, con dos decimales como mucho.';
  if (type === 'expense' && !EXPENSE_CATEGORIES[category]) return 'Elige la categoría del gasto.';
  return reasonProblem(reason);
}

export function reasonProblem(reason: string): string | null {
  const length = reason.trim().length;
  return length < 3 || length > 200 ? 'Indica el motivo (entre 3 y 200 caracteres).' : null;
}
