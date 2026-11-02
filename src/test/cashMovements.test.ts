import { describe, expect, it } from 'vitest';
import {
  movementProblem, movementTotals, parseMovementAmount, reasonProblem, type CashMovement, type CashMovementType,
} from '@/lib/cashMovements';

const mov = (movement_type: CashMovementType, amount: number, voided = false): CashMovement => ({
  id: `${movement_type}-${amount}`,
  movement_type,
  amount,
  category: movement_type === 'expense' ? 'drinks' : null,
  reason: 'Motivo',
  who: 'Luis',
  created_at: '2026-11-02T10:00:00Z',
  voided_at: voided ? '2026-11-02T11:00:00Z' : null,
  voided_who: voided ? 'Luis' : null,
  void_reason: voided ? 'Error' : null,
});

describe('totales de movimientos', () => {
  it('suma por tipo y calcula lo que cambia el efectivo', () => {
    expect(movementTotals([mov('expense', 3.5), mov('expense', 1.2), mov('cash_in', 20), mov('withdrawal', 50)])).toEqual({
      cashIn: 20, expenses: 4.7, withdrawals: 50, net: -34.7,
    });
  });

  it('no cuenta los anulados', () => {
    expect(movementTotals([mov('expense', 30, true), mov('expense', 3)])).toMatchObject({ expenses: 3, net: -3 });
  });

  it('admite importes como texto, como los da la base de datos', () => {
    const texto = { ...mov('cash_in', 0), amount: '12.50' as unknown as number };
    expect(movementTotals([texto]).cashIn).toBe(12.5);
  });

  it('sin movimientos, cero', () => {
    expect(movementTotals([])).toEqual({ cashIn: 0, expenses: 0, withdrawals: 0, net: 0 });
  });

  it('no arrastra errores de redondeo', () => {
    expect(movementTotals([mov('expense', 0.1), mov('expense', 0.2)]).expenses).toBe(0.3);
  });
});

describe('importe escrito', () => {
  it('lee coma, punto y símbolo', () => {
    expect(parseMovementAmount('3,50')).toBe(3.5);
    expect(parseMovementAmount('3.5')).toBe(3.5);
    expect(parseMovementAmount(' 12 € ')).toBe(12);
  });

  it('rechaza vacío, cero, negativo, más de dos decimales y letras', () => {
    for (const raw of ['', '0', '-3', '1,234', 'abc', '99999999']) {
      expect(parseMovementAmount(raw)).toBeNull();
    }
  });
});

describe('lo que falta para guardar', () => {
  it('un gasto necesita categoría; una entrada o retirada, no', () => {
    expect(movementProblem('expense', '3', '', 'Agua')).toMatch(/categoría/);
    expect(movementProblem('expense', '3', 'viajes', 'Agua')).toMatch(/categoría/);
    expect(movementProblem('expense', '3', 'drinks', 'Agua')).toBeNull();
    expect(movementProblem('cash_in', '3', '', 'Cambio')).toBeNull();
    expect(movementProblem('withdrawal', '3', '', 'Banco')).toBeNull();
  });

  it('pide importe y motivo', () => {
    expect(movementProblem('cash_in', '0', '', 'Cambio')).toMatch(/importe/);
    expect(movementProblem('cash_in', '3', '', ' a ')).toMatch(/motivo/);
    expect(reasonProblem('x'.repeat(201))).toMatch(/motivo/);
    expect(reasonProblem('Bien')).toBeNull();
  });
});
