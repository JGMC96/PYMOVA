import { describe, expect, it } from 'vitest';
import { cashChange, describeOpenedAt, isOpenFromEarlierDay, parseCash, quickCashAmounts } from '@/lib/cobro';

describe('importes rápidos de efectivo', () => {
  it('da el exacto y los billetes siguientes', () => {
    expect(quickCashAmounts(37.5)).toEqual([37.5, 40, 50, 100]);
    expect(quickCashAmounts(119)).toEqual([119, 120, 150, 200]);
  });

  it('no repite el exacto si ya es redondo', () => {
    expect(quickCashAmounts(50)).toEqual([50, 60, 100, 200]);
    expect(quickCashAmounts(20)).toEqual([20, 50, 100, 200]);
  });

  it('sin total no hay importes', () => {
    expect(quickCashAmounts(0)).toEqual([]);
  });
});

describe('cambio', () => {
  it('calcula el cambio con coma o punto decimal', () => {
    expect(cashChange('50', 37.5)).toBe(12.5);
    expect(cashChange('40,10', 37.5)).toBe(2.6);
  });

  it('negativo si falta dinero y null si está vacío', () => {
    expect(cashChange('30', 37.5)).toBe(-7.5);
    expect(cashChange('', 37.5)).toBeNull();
    expect(parseCash('')).toBeNull();
    expect(parseCash('12,345')).toBe(12.35);
  });
});

describe('caja abierta de otro día', () => {
  const ahora = new Date(2026, 9, 21, 10, 0);

  it('avisa si se abrió ayer o antes', () => {
    expect(isOpenFromEarlierDay(new Date(2026, 9, 19, 16, 52), ahora)).toBe(true);
    expect(isOpenFromEarlierDay(new Date(2026, 9, 20, 23, 59), ahora)).toBe(true);
  });

  it('no avisa si se abrió hoy', () => {
    expect(isOpenFromEarlierDay(new Date(2026, 9, 21, 0, 0), ahora)).toBe(false);
    expect(isOpenFromEarlierDay(new Date(2026, 9, 21, 9, 30), ahora)).toBe(false);
  });

  it('describe cuándo se abrió', () => {
    expect(describeOpenedAt(new Date(2026, 9, 19, 16, 52))).toBe('el lunes 19/10 a las 16:52');
  });
});
