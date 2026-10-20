import { describe, expect, it } from 'vitest';
import { buildCorrection } from '@/lib/timeCorrection';

const base = { date: '2026-10-14', entrada: '11:00', salida: '14:00', pausaMinutos: '15', motivo: 'Olvidó fichar la salida' };
const horas = (r: ReturnType<typeof buildCorrection>) => {
  if ('error' in r) throw new Error(r.error);
  return (r.correction.clockOutAt.getTime() - r.correction.clockInAt.getTime()) / 3_600_000;
};

describe('buildCorrection', () => {
  it('convierte la mañana de una jornada partida', () => {
    const r = buildCorrection(base);
    expect(horas(r)).toBe(3);
    expect(r).toMatchObject({ correction: { breakSeconds: 900, reason: 'Olvidó fichar la salida' } });
  });

  it('una salida anterior a la entrada es del día siguiente', () => {
    expect(horas(buildCorrection({ ...base, entrada: '22:00', salida: '02:00', pausaMinutos: '0' }))).toBe(4);
  });

  it('rechaza motivo corto, pausas inválidas y horas vacías', () => {
    expect(buildCorrection({ ...base, motivo: ' ok ' })).toEqual({ error: expect.stringMatching(/motivo/) });
    expect(buildCorrection({ ...base, pausaMinutos: '180' })).toEqual({ error: expect.stringMatching(/pausa/) });
    expect(buildCorrection({ ...base, pausaMinutos: '-5' })).toEqual({ error: expect.stringMatching(/pausas/i) });
    expect(buildCorrection({ ...base, pausaMinutos: '7.5' })).toEqual({ error: expect.stringMatching(/pausas/i) });
    expect(buildCorrection({ ...base, salida: '' })).toEqual({ error: expect.stringMatching(/salida/) });
    expect(buildCorrection({ ...base, salida: '11:00' })).toEqual({ error: expect.stringMatching(/posterior/) });
  });
});
