import { describe, expect, it } from 'vitest';
import { CLOSING_WITHDRAWAL_REASON, closingDocFromHistory } from '@/lib/cierreCaja';
import { PAYMENT_LABELS } from '@/lib/storeProfiles';
import { renderClosingBody } from '@/lib/ticket';

const nombres: Record<string, string> = { e1: 'Lucía' };
const personName = (id: string | null | undefined) => (id ? nombres[id] ?? null : null);
const mov = (over: Partial<{ movement_type: string; amount: number; reason: string; created_at: string; voided_at: string | null }>) => ({
  movement_type: 'withdrawal', amount: 0, reason: 'Algo', created_at: '2026-11-20T18:00:00Z', voided_at: null, ...over,
});

// Cierre del 20/11 con el asistente: fondo 90, 291,20 en efectivo y 420 con tarjeta; se contaron
// 381,20, se retiraron 291,20 al cerrar y quedaron 90 (lo que guardó el servidor).
const sesion = {
  opened_at: '2026-11-20T10:27:00Z', closed_at: '2026-11-20T18:44:00Z', opening_amount: '90.00',
  expected_amount: '90.00', counted_amount: '90.00', difference: '0.00', notes: 'Todo bien',
  opened_by_employee_id: 'e1', closed_by_employee_id: 'e1',
};
const resumen = [
  { payment_method: 'card', sales_count: '3', total_amount: '420.00', refunds_count: 0, refunds_amount: '0' },
  { payment_method: 'cash', sales_count: '1', total_amount: '291.20', refunds_count: 0, refunds_amount: '0' },
];

describe('reimprimir un cierre del historial', () => {
  it('sale como el original: esperado y contado antes de la retirada, lo retirado y lo que quedó', () => {
    const doc = closingDocFromHistory({
      session: sesion, summary: resumen, labels: PAYMENT_LABELS, personName,
      movements: [mov({ amount: 291.2, reason: CLOSING_WITHDRAWAL_REASON, created_at: '2026-11-20T18:43:00Z' })],
    });
    expect(doc).toMatchObject({
      openedBy: 'Lucía', closedBy: 'Lucía', opening: 90, expected: 381.2, countedTotal: 381.2, difference: 0,
      withdrawal: 291.2, keep: 90, withdrawalsBefore: 0, cardTerminal: null, notes: 'Todo bien',
    });
    expect(doc.payments).toEqual([
      { method: 'card', label: 'Tarjeta', count: 3, amount: 420 },
      { method: 'cash', label: 'Efectivo', count: 1, amount: 291.2 },
    ]);
    const html = renderClosingBody({ name: 'Tienda' }, doc);
    expect(html).toMatch(/Esperado en el cajón<\/span><span>381,20 €/);
    expect(html).toMatch(/Retirado al banco<\/span><span>291,20 €/);
    expect(html).toMatch(/Queda en caja<\/span><span>90,00 €/);
    expect(html).not.toContain('Datáfono');
  });

  it('las demás retiradas, gastos y entradas del turno van aparte; lo anulado no cuenta', () => {
    const doc = closingDocFromHistory({
      session: { ...sesion, expected_amount: '70.00', counted_amount: '70.00' },
      summary: resumen, labels: PAYMENT_LABELS, personName,
      movements: [
        mov({ amount: 100, reason: 'Ingreso en el banco a mediodía', created_at: '2026-11-20T13:00:00Z' }),
        mov({ movement_type: 'expense', amount: 4.5, reason: 'Agua' }),
        mov({ movement_type: 'cash_in', amount: 20, reason: 'Cambio' }),
        mov({ movement_type: 'expense', amount: 50, reason: 'Anulado', voided_at: '2026-11-20T15:00:00Z' }),
        mov({ amount: 191.2, reason: CLOSING_WITHDRAWAL_REASON, created_at: '2026-11-20T18:43:00Z' }),
      ],
    });
    expect(doc).toMatchObject({ withdrawalsBefore: 100, expenses: 4.5, cashIn: 20, withdrawal: 191.2, keep: 70, countedTotal: 261.2, expected: 261.2 });
  });

  it('si el cierre falló una vez y se reintentó, cuenta la última retirada del cierre (la otra se anuló)', () => {
    const doc = closingDocFromHistory({
      session: sesion, summary: resumen, labels: PAYMENT_LABELS, personName,
      movements: [
        mov({ amount: 291.2, reason: CLOSING_WITHDRAWAL_REASON, created_at: '2026-11-20T18:40:00Z', voided_at: '2026-11-20T18:41:00Z' }),
        mov({ amount: 291.2, reason: CLOSING_WITHDRAWAL_REASON, created_at: '2026-11-20T18:43:00Z' }),
      ],
    });
    expect(doc).toMatchObject({ withdrawal: 291.2, withdrawalsBefore: 0, keep: 90 });
  });

  it('un cierre de antes del asistente: sin retirada, lo contado es lo que quedó', () => {
    const doc = closingDocFromHistory({
      session: { ...sesion, expected_amount: '381.20', counted_amount: '90.00', difference: '-291.20' },
      summary: resumen, labels: PAYMENT_LABELS, personName, movements: [],
    });
    expect(doc).toMatchObject({ expected: 381.2, countedTotal: 90, difference: -291.2, withdrawal: 0, keep: 90 });
  });

  it('una venta mixta sale repartida, como en el resumen del cierre', () => {
    const doc = closingDocFromHistory({
      session: sesion, labels: PAYMENT_LABELS, personName, movements: [],
      summary: [
        { payment_method: 'card', sales_count: '1', total_amount: '79', refunds_amount: null },
        { payment_method: 'cash', sales_count: '1', total_amount: '50', refunds_amount: '10' },
      ],
    });
    expect(doc.payments.map((p) => [p.label, p.amount])).toEqual([['Tarjeta', 79], ['Efectivo', 50]]);
    expect(doc.cashRefunds).toBe(10);
  });
});
