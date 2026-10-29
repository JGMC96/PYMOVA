import { describe, expect, it } from 'vitest';
import { easterSunday, keyDatesForYear, upcomingKeyDates } from './marketingKeyDates';

const fecha = (year: number, name: string) => keyDatesForYear(year).find((k) => k.name === name);

describe('fechas clave de marketing', () => {
  it('calcula el domingo de Pascua', () => {
    expect(easterSunday(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easterSunday(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
  });

  it('pone Black Friday el viernes después del cuarto jueves de noviembre', () => {
    expect(fecha(2026, 'Black Friday')).toMatchObject({ starts_on: '2026-11-27', ends_on: '2026-11-27' });
    expect(fecha(2026, 'Cyber Monday')).toMatchObject({ starts_on: '2026-11-30' });
    expect(fecha(2027, 'Black Friday')).toMatchObject({ starts_on: '2027-11-26' });
  });

  it('pone el Día de la Madre el primer domingo de mayo', () => {
    expect(fecha(2026, 'Día de la Madre')).toMatchObject({ starts_on: '2026-05-03' });
    expect(fecha(2027, 'Día de la Madre')).toMatchObject({ starts_on: '2027-05-02' });
  });

  it('incluye Fallas y Semana Santa como franjas', () => {
    expect(fecha(2027, 'Fallas')).toMatchObject({ starts_on: '2027-03-15', ends_on: '2027-03-19' });
    expect(fecha(2027, 'Semana Santa')).toMatchObject({ starts_on: '2027-03-21', ends_on: '2027-03-28' });
  });

  it('da los próximos 12 meses sin repetir ni dejar fuera las que están en curso', () => {
    const lista = upcomingKeyDates(new Date(2026, 9, 28));
    const nombres = lista.map((k) => `${k.name} ${k.starts_on.slice(0, 4)}`);

    expect(nombres[0]).toBe('Black Friday 2026');
    expect(nombres).toContain('Navidad 2026');
    expect(nombres).toContain('Rebajas de verano 2027');
    expect(nombres).not.toContain('Black Friday 2027');
    expect(nombres).not.toContain('Fallas 2026');
    expect(new Set(nombres).size).toBe(nombres.length);

    // Una franja que ya ha empezado sigue saliendo.
    expect(upcomingKeyDates(new Date(2027, 0, 20)).map((k) => k.name)).toContain('Rebajas de invierno');
  });
});
