// Periodos de fechas para los informes (fechas locales en formato AAAA-MM-DD).

export type Preset = 'today' | 'last7' | 'month' | 'lastMonth' | 'last30' | 'year' | 'custom';

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Hoy',
  last7: 'Últimos 7 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
  last30: 'Últimos 30 días',
  year: 'Este año',
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

export function presetRange(preset: Exclude<Preset, 'custom'>, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (preset) {
    case 'today':
      return { from: ymd(today), to: ymd(today) };
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
