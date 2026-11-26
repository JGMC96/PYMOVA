import { describe, expect, it } from 'vitest';
import { fmt, monthRange, presetRange } from '@/lib/periodos';

// 21/10/2026, miércoles, a media tarde (hora local).
const AHORA = new Date(2026, 9, 21, 17, 30);

describe('periodos de los informes', () => {
  it('este mes va del día 1 a hoy', () => {
    expect(presetRange('month', AHORA)).toEqual({ from: '2026-10-01', to: '2026-10-21' });
  });

  it('mes pasado es el mes natural anterior completo', () => {
    expect(presetRange('lastMonth', AHORA)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('lastMonth', new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('lastMonth', new Date(2026, 2, 31))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('hoy, 7 y 30 días incluyen el día de hoy', () => {
    expect(presetRange('today', AHORA)).toEqual({ from: '2026-10-21', to: '2026-10-21' });
    expect(presetRange('last7', AHORA)).toEqual({ from: '2026-10-15', to: '2026-10-21' });
    expect(presetRange('last30', AHORA)).toEqual({ from: '2026-09-22', to: '2026-10-21' });
  });

  it('este año empieza el 1 de enero', () => {
    expect(presetRange('year', AHORA)).toEqual({ from: '2026-01-01', to: '2026-10-21' });
  });

  it('ayer, el año pasado y los últimos 12 meses', () => {
    expect(presetRange('yesterday', AHORA)).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(presetRange('yesterday', new Date(2026, 0, 1))).toEqual({ from: '2025-12-31', to: '2025-12-31' });
    expect(presetRange('lastYear', AHORA)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('last12', AHORA)).toEqual({ from: '2025-11-01', to: '2026-10-21' });
  });

  it('un mes elegido va entero, y el actual solo hasta hoy', () => {
    expect(monthRange('2026-02', AHORA)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02', AHORA)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-10', AHORA)).toEqual({ from: '2026-10-01', to: '2026-10-21' });
    expect(monthRange('', AHORA)).toEqual({ from: '', to: '' });
  });

  it('muestra las fechas en formato español', () => {
    expect(fmt('2026-10-01')).toBe('1/10/2026');
  });
});
