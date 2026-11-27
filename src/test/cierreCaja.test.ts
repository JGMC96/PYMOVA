import { describe, expect, it } from 'vitest';
import {
  cashOutcome, countTotal, expectedBreakdown, parseCash, suggestedOpening, withdrawalPlan, type ClosingDoc,
} from '@/lib/cierreCaja';
import { renderClosingBody } from '@/lib/ticket';

describe('cierre de caja: lo que debería haber en el cajón', () => {
  it('fondo + ventas en efectivo − devoluciones + entradas − gastos − retiradas, línea a línea', () => {
    const r = expectedBreakdown({ opening: 90, cashSales: 291.2, cashRefunds: 20, cashIn: 50, expenses: 4.5, withdrawals: 100 });
    expect(r.total).toBe(306.7);
    expect(r.lines.map((l) => [l.label, l.amount])).toEqual([
      ['Fondo al abrir', 90],
      ['Ventas en efectivo', 291.2],
      ['Devoluciones en efectivo', -20],
      ['Entradas de cambio', 50],
      ['Gastos pagados de la caja', -4.5],
      ['Retiradas al banco', -100],
    ]);
  });

  it('solo salen las líneas con algo; el fondo, siempre', () => {
    const r = expectedBreakdown({ opening: 0, cashSales: 0, cashRefunds: 0, cashIn: 0, expenses: 0, withdrawals: 0 });
    expect(r.lines.map((l) => l.label)).toEqual(['Fondo al abrir']);
    expect(r.total).toBe(0);
  });
});

describe('cierre de caja: contar', () => {
  it('por billetes y monedas', () => {
    expect(countTotal({ '50': '2', '20': '1', '0.5': '3', '0.01': '7' })).toBe(121.57);
    expect(countTotal({ '500': 1, '0.2': 5 })).toBe(501);
    expect(countTotal({})).toBe(0);
    // Basura o negativos no cuentan.
    expect(countTotal({ '10': '-2', '5': 'abc', '2': '1.9' })).toBe(2);
  });

  it('el total a mano, con coma o punto; 0 vale', () => {
    expect(parseCash('381,20')).toBe(381.2);
    expect(parseCash('90')).toBe(90);
    expect(parseCash('0')).toBe(0);
    expect(parseCash('')).toBeNull();
    expect(parseCash('-5')).toBeNull();
    expect(parseCash('abc')).toBeNull();
  });

  it('cuadra, faltan o sobran', () => {
    expect(cashOutcome(381.2, 381.2)).toEqual({ difference: 0, text: 'Cuadra', ok: true });
    expect(cashOutcome(90, 381.2)).toEqual({ difference: -291.2, text: 'Faltan 291,20 €', ok: false });
    expect(cashOutcome(190, 100)).toEqual({ difference: 90, text: 'Sobran 90,00 €', ok: false });
  });
});

describe('cierre de caja: lo que se retira y lo que se deja', () => {
  it('se retira lo contado menos lo que se deja para mañana', () => {
    expect(withdrawalPlan(381.2, 90, 381.2)).toEqual({ withdrawal: 291.2, keep: 90, capped: false, problem: null });
    expect(withdrawalPlan(90, 90, 90)).toEqual({ withdrawal: 0, keep: 90, capped: false, problem: null });
    expect(withdrawalPlan(381.2, 0, 381.2)).toEqual({ withdrawal: 381.2, keep: 0, capped: false, problem: null });
  });

  it('si falta dinero, se retira igual lo contado menos el fondo, y la diferencia no cambia', () => {
    const plan = withdrawalPlan(370, 90, 381.2);
    expect(plan).toMatchObject({ withdrawal: 280, keep: 90, capped: false });
    // Lo que guarda el servidor: contado = lo que queda; esperado = esperado − retirada.
    expect(cashOutcome(plan.keep, 381.2 - plan.withdrawal).difference).toBe(cashOutcome(370, 381.2).difference);
  });

  it('el servidor no deja retirar más que lo esperado: si sobra mucho, el resto se queda', () => {
    expect(withdrawalPlan(200, 0, 120)).toEqual({ withdrawal: 120, keep: 80, capped: true, problem: null });
    // A ciegas no se sabe el esperado: no se recorta (si se pasa, lo dirá el servidor).
    expect(withdrawalPlan(200, 0, null)).toEqual({ withdrawal: 200, keep: 0, capped: false, problem: null });
  });

  it('no se puede dejar más de lo contado', () => {
    expect(withdrawalPlan(50, 90, 50).problem).toMatch(/más de lo que has contado/);
  });

  it('el fondo que se propone al abrir es lo que quedó en el último cierre', () => {
    expect(suggestedOpening({ counted_amount: 90 })).toBe(90);
    expect(suggestedOpening({ counted_amount: null })).toBeNull();
    expect(suggestedOpening(undefined)).toBeNull();
  });
});

describe('ticket del cierre de caja', () => {
  const doc: ClosingDoc = {
    openedAt: '2026-11-20T10:27:00Z',
    closedAt: '2026-11-20T18:44:00Z',
    openedBy: 'Lucía',
    closedBy: 'Lucía',
    opening: 90,
    payments: [
      { method: 'cash', label: 'Efectivo', count: 1, amount: 291.2 },
      { method: 'card', label: 'Tarjeta', count: 3, amount: 420 },
    ],
    cashRefunds: 0,
    cashIn: 0,
    expenses: 0,
    withdrawalsBefore: 0,
    expected: 381.2,
    countedTotal: 381.2,
    difference: 0,
    withdrawal: 291.2,
    keep: 90,
    cardTerminal: 420,
    notes: 'Todo bien <ok>',
  };

  it('lleva ventas, esperado, contado, diferencia, retirada y lo que queda', () => {
    const html = renderClosingBody({ name: 'Tienda' }, doc);
    expect(html).toContain('CIERRE DE CAJA');
    expect(html).toContain('Efectivo (1)');
    expect(html).toContain('Tarjeta (3)');
    expect(html).toMatch(/Esperado en el cajón<\/span><span>381,20 €/);
    expect(html).toMatch(/Diferencia<\/span><span>Cuadra/);
    expect(html).toMatch(/Retirado al banco<\/span><span>291,20 €/);
    expect(html).toMatch(/Queda en caja<\/span><span>90,00 €/);
    expect(html).toContain('Datáfono');
    expect(html).toContain('Todo bien &lt;ok&gt;');
  });

  it('a ciegas, los importes que no se ven salen con guion', () => {
    const html = renderClosingBody({ name: 'Tienda' }, {
      ...doc, payments: [{ method: 'cash', label: 'Efectivo', count: 1, amount: null }], expected: null, difference: null, cardTerminal: null,
    });
    expect(html).toMatch(/Efectivo \(1\)<\/span><span>—/);
    expect(html).toMatch(/Diferencia<\/span><span>—/);
    expect(html).not.toContain('Datáfono');
  });

  it('si no cuadra, dice cuánto falta', () => {
    const html = renderClosingBody({ name: 'Tienda' }, { ...doc, countedTotal: 90, difference: -291.2 });
    expect(html).toMatch(/Diferencia<\/span><span>Faltan 291,20 €/);
  });
});
