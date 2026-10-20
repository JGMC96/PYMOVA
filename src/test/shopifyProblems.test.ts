import { describe, expect, it } from 'vitest';
import { failedCount, problemsSummary, type ShopifyProblem } from '@/lib/shopifyProblems';

const p = (kind: ShopifyProblem['kind'], state: ShopifyProblem['state'] = 'failed'): ShopifyProblem => ({
  kind,
  state,
  record_id: Math.random().toString(36),
  reference: null,
  error: null,
  attempts: 5,
  happened_at: '2026-10-20T10:00:00Z',
});

describe('problemsSummary', () => {
  it('sin fallos definitivos no hay aviso (lo que se reintenta o espera no cuenta)', () => {
    expect(problemsSummary([])).toBeNull();
    expect(problemsSummary([p('venta', 'retrying'), p('devolucion', 'waiting')])).toBeNull();
    expect(failedCount([p('venta', 'retrying'), p('stock')])).toBe(1);
  });

  it('cuenta por tipo, en singular y plural', () => {
    expect(problemsSummary([p('venta')])).toBe('1 venta no se ha procesado en Shopify');
    expect(problemsSummary([p('venta'), p('venta'), p('devolucion')])).toBe(
      '2 ventas y 1 devolución no se han procesado en Shopify',
    );
    expect(problemsSummary([p('venta'), p('stock'), p('stock'), p('aviso')])).toBe(
      '1 venta, 2 cambios de stock y 1 aviso de Shopify no se han procesado en Shopify',
    );
  });
});
