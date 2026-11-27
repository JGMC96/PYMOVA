// Periodos de fechas para los informes (fechas locales en formato AAAA-MM-DD).

export type Preset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'month'
  | 'lastMonth'
  | 'pickMonth'
  | 'last12'
  | 'year'
  | 'lastYear'
  | 'custom';

/** Preajustes cuyas fechas se calculan solas a partir del día de hoy. */
export type FixedPreset = Exclude<Preset, 'custom' | 'pickMonth'>;

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: 'Últimos 7 días',
  last30: 'Últimos 30 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
  pickMonth: 'Elegir mes',
  last12: 'Últimos 12 meses',
  year: 'Este año',
  lastYear: 'Año pasado',
  custom: 'Personalizado',
};

/** Fecha local en formato AAAA-MM-DD (para los campos de fecha). */
export const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** AAAA-MM-DD a fecha local a las 00:00. */
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const fmt = (s: string) => parseYmd(s).toLocaleDateString('es-ES');

export function presetRange(preset: FixedPreset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (preset) {
    case 'today':
      return { from: ymd(today), to: ymd(today) };
    case 'yesterday':
      return { from: ymd(daysAgo(1)), to: ymd(daysAgo(1)) };
    case 'last12':
      // Doce meses naturales contando el actual.
      return { from: ymd(new Date(today.getFullYear(), today.getMonth() - 11, 1)), to: ymd(today) };
    case 'lastYear':
      return { from: ymd(new Date(today.getFullYear() - 1, 0, 1)), to: ymd(new Date(today.getFullYear() - 1, 11, 31)) };
    case 'last7':
      return { from: ymd(daysAgo(6)), to: ymd(today) };
    case 'last30':
      return { from: ymd(daysAgo(29)), to: ymd(today) };
    case 'lastMonth':
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case 'year':
      return { from: ymd(new Date(today.getFullYear(), 0, 1)), to: ymd(today) };
    case 'month':
    default:
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
  }
}

/** Un mes elegido (AAAA-MM): del día 1 al último, sin pasar de hoy. */
export function monthRange(month: string, now = new Date()): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return { from: '', to: '' };
  const first = ymd(new Date(y, m - 1, 1));
  const last = ymd(new Date(y, m, 0));
  const today = ymd(now);
  return { from: first, to: last > today && first <= today ? today : last };
}
