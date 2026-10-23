import { describe, expect, it } from 'vitest';
import type { MonthlyReportRow } from '@/hooks/useHrReports';
import {
  buildMonthlyCsv,
  formatSeconds,
  formatSessionDate,
  monthName,
  monthlyTotals,
  reportYears,
  sessionStatusLabel,
} from '@/lib/hrReport';

const fila = (over: Partial<MonthlyReportRow> = {}): MonthlyReportRow => ({
  id: 's1',
  session_date: '2026-10-01',
  // Horas locales del navegador, igual que las muestra la pantalla.
  clock_in_at: new Date(2026, 9, 1, 9, 0).toISOString(),
  clock_out_at: new Date(2026, 9, 1, 14, 30).toISOString(),
  worked_seconds: 5 * 3600,
  break_seconds: 30 * 60,
  status: 'closed',
  needs_review: false,
  correction_reason: null,
  ...over,
});

describe('formatSeconds', () => {
  it('muestra horas y minutos con dos cifras', () => {
    expect(formatSeconds(0)).toBe('0h 00m');
    expect(formatSeconds(5 * 3600 + 7 * 60 + 59)).toBe('5h 07m');
    expect(formatSeconds(40 * 3600)).toBe('40h 00m');
  });
});

describe('formatSessionDate', () => {
  it('lee la fecha como texto, sin desfase por zona horaria', () => {
    expect(formatSessionDate('2026-10-01')).toBe('01/10/2026');
    expect(formatSessionDate('2026-12-31')).toBe('31/12/2026');
  });
});

describe('sessionStatusLabel', () => {
  it('prioriza la revisión pendiente, después la corrección y después el estado', () => {
    expect(sessionStatusLabel(fila())).toBe('Cerrada');
    expect(sessionStatusLabel(fila({ status: 'open', clock_out_at: null }))).toBe('Abierta');
    expect(sessionStatusLabel(fila({ correction_reason: 'Olvidó la salida' }))).toBe('Corregida');
    expect(sessionStatusLabel(fila({ needs_review: true, correction_reason: 'x' }))).toBe('Pendiente de revisión');
  });
});

describe('monthlyTotals', () => {
  it('suma horas, pausas y sesiones pendientes', () => {
    const t = monthlyTotals([
      fila(),
      fila({ id: 's2', worked_seconds: 3600, break_seconds: 0 }),
      fila({ id: 's3', worked_seconds: 0, break_seconds: 0, needs_review: true }),
    ]);
    expect(t).toEqual({ worked: 6 * 3600, breaks: 30 * 60, pending: 1 });
  });

  it('da ceros sin filas', () => {
    expect(monthlyTotals([])).toEqual({ worked: 0, breaks: 0, pending: 0 });
  });
});

describe('buildMonthlyCsv', () => {
  it('escribe la cabecera y una línea por sesión', () => {
    const csv = buildMonthlyCsv([fila(), fila({ id: 's2', status: 'open', clock_out_at: null })]);
    const [cabecera, primera, segunda] = csv.split('\n');
    expect(cabecera).toBe('"Fecha","Entrada","Salida","Trabajado(h)","Pausas(h)","Estado","Motivo de corrección"');
    expect(primera).toBe('"2026-10-01","09:00","14:30","5.00","0.50","Cerrada",""');
    expect(segunda).toBe('"2026-10-01","09:00","","5.00","0.50","Abierta",""');
  });

  it('incluye el motivo de corrección y neutraliza fórmulas', () => {
    const csv = buildMonthlyCsv([fila({ correction_reason: '=HYPERLINK("http://x")' })]);
    expect(csv.split('\n')[1]).toBe(
      '"2026-10-01","09:00","14:30","5.00","0.50","Corregida","\'=HYPERLINK(""http://x"")"',
    );
  });

  it('sin sesiones, solo la cabecera', () => {
    expect(buildMonthlyCsv([]).split('\n')).toHaveLength(1);
  });
});

describe('monthName y reportYears', () => {
  it('da el mes en español', () => {
    expect(monthName(1)).toBe('enero');
    expect(monthName(10)).toBe('octubre');
  });

  it('ofrece el año actual y los 4 anteriores', () => {
    expect(reportYears(2026)).toEqual([2026, 2025, 2024, 2023, 2022]);
  });
});
