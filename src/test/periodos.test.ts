import { describe, expect, it } from 'vitest';
import { fmt, presetRange } from '@/lib/periodos';

// 21/10/2026, miércoles, a media tarde (hora local).
const AHORA = new Date(2026, 9, 21, 17, 30);

describe('periodos de la facturación online', () => {
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

  it('muestra las fechas en formato español', () => {
    expect(fmt('2026-10-01')).toBe('1/10/2026');
  });
});
