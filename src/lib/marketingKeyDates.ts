// Fechas clave de comercio en España (y Valencia) para el calendario de marketing.
// Se cargan por negocio con un botón; luego cada negocio las cambia o borra.

export interface KeyDate {
  name: string;
  starts_on: string; // AAAA-MM-DD
  ends_on: string;
  color: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date);

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return day(year, month, date);
}

/** n-ésimo día de la semana (0 = domingo) de un mes. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = day(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return day(year, month, 1 + offset + (n - 1) * 7);
}

export function keyDatesForYear(year: number): KeyDate[] {
  const easter = easterSunday(year);
  const blackFriday = addDays(nthWeekday(year, 11, 4, 4), 1); // viernes tras el 4.º jueves de noviembre
  const one = (name: string, d: Date, color: string): KeyDate => ({ name, starts_on: iso(d), ends_on: iso(d), color });
  const range = (name: string, from: Date, to: Date, color: string): KeyDate => ({
    name,
    starts_on: iso(from),
    ends_on: iso(to),
    color,
  });

  return [
    one('Reyes', day(year, 1, 6), '#a855f7'),
    range('Rebajas de invierno', day(year, 1, 7), day(year, 2, 28), '#ef4444'),
    one('San Valentín', day(year, 2, 14), '#ec4899'),
    range('Fallas', day(year, 3, 15), day(year, 3, 19), '#f97316'),
    one('Día del Padre', day(year, 3, 19), '#0ea5e9'),
    range('Semana Santa', addDays(easter, -7), easter, '#eab308'),
    one('Día de la Madre', nthWeekday(year, 5, 0, 1), '#ec4899'),
    range('Rebajas de verano', day(year, 7, 1), day(year, 8, 31), '#ef4444'),
    range('Vuelta al cole', day(year, 9, 1), day(year, 9, 15), '#22c55e'),
    one('Black Friday', blackFriday, '#111827'),
    one('Cyber Monday', addDays(blackFriday, 3), '#111827'),
    range('Navidad', day(year, 12, 1), day(year, 12, 24), '#16a34a'),
  ];
}

/** Fechas clave de los próximos 12 meses desde `from` (las que aún no han terminado). */
export function upcomingKeyDates(from: Date): KeyDate[] {
  const start = iso(from);
  const end = iso(new Date(from.getFullYear() + 1, from.getMonth(), from.getDate()));
  return [...keyDatesForYear(from.getFullYear()), ...keyDatesForYear(from.getFullYear() + 1)].filter(
    (k) => k.ends_on >= start && k.starts_on < end,
  );
}
