import { describe, expect, it } from 'vitest';
import { buildAdjustReason, buildStockLines, type StockGridRow } from '@/lib/stockAdjust';

describe('buildAdjustReason', () => {
  it('usa el motivo y añade la nota si la hay', () => {
    expect(buildAdjustReason('Recuento', '')).toBe('Recuento');
    expect(buildAdjustReason('Rotura o defecto', ' suela despegada ')).toBe('Rotura o defecto: suela despegada');
  });

  it('«Otro» exige una nota de al menos 3 caracteres', () => {
    expect(buildAdjustReason('Otro', '')).toBeNull();
    expect(buildAdjustReason('Otro', 'ok')).toBeNull();
    expect(buildAdjustReason('Otro', 'Regalo a clienta')).toBe('Regalo a clienta');
  });
});

describe('buildStockLines (rejilla de tallas)', () => {
  const tallas: StockGridRow[] = [
    { variantId: 'v38', name: '38', current: 5 },
    { variantId: 'v39', name: '39', current: 3 },
    { variantId: 'v40', name: '40', current: 0 },
  ];

  it('stock nuevo: solo manda las tallas que cambian, con el stock que se vio', () => {
    expect(buildStockLines(tallas, { v38: '4', v39: '3', v40: ' 2 ' }, 'set')).toEqual({
      lines: [
        { variant_id: 'v38', expected: 5, new_quantity: 4 },
        { variant_id: 'v40', expected: 0, new_quantity: 2 },
      ],
      error: null,
    });
    expect(buildStockLines(tallas, {}, 'set')).toEqual({ lines: [], error: null });
  });

  it('sumar a lo que hay: entradas con o sin «+» y salidas con «-»', () => {
    expect(buildStockLines(tallas, { v38: '+2', v39: '-1', v40: '0' }, 'add').lines).toEqual([
      { variant_id: 'v38', expected: 5, new_quantity: 7 },
      { variant_id: 'v39', expected: 3, new_quantity: 2 },
    ]);
  });

  it('rechaza decimales, texto y stock negativo', () => {
    expect(buildStockLines(tallas, { v38: '1,5' }, 'set').error).toMatch(/38.*entero/);
    expect(buildStockLines(tallas, { v39: 'dos' }, 'set').error).toMatch(/entero/);
    expect(buildStockLines(tallas, { v40: '-1' }, 'set').error).toMatch(/negativo/);
    expect(buildStockLines(tallas, { v39: '-4' }, 'add').error).toBe('39: solo hay 3, no se pueden quitar 4');
  });

  it('producto sin tallas: una sola línea sin variante', () => {
    expect(buildStockLines([{ variantId: null, name: 'Calcetín', current: 10 }], { producto: '8' }, 'set').lines).toEqual([
      { variant_id: null, expected: 10, new_quantity: 8 },
    ]);
  });
});
