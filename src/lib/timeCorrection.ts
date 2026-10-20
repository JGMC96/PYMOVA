// Validación y conversión del formulario de corrección de fichajes.
// Las horas se interpretan en la zona horaria del navegador (la misma en la
// que se muestran en el informe). Si la salida es anterior a la entrada, se
// entiende que la salida es del día siguiente (turno que pasa de medianoche).
import type { SessionCorrection } from '@/hooks/useHrReports';

export interface CorrectionForm {
  date: string; // yyyy-MM-dd
  entrada: string; // HH:mm
  salida: string; // HH:mm
  pausaMinutos: string;
  motivo: string;
}

const HORA = /^\d{2}:\d{2}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function buildCorrection(
  form: CorrectionForm,
): { correction: SessionCorrection } | { error: string } {
  if (!FECHA.test(form.date)) return { error: 'Indica la fecha' };
  if (!HORA.test(form.entrada) || !HORA.test(form.salida)) return { error: 'Indica la hora de entrada y la de salida' };

  const clockInAt = new Date(`${form.date}T${form.entrada}:00`);
  const clockOutAt = new Date(`${form.date}T${form.salida}:00`);
  if (Number.isNaN(clockInAt.getTime()) || Number.isNaN(clockOutAt.getTime())) return { error: 'Fecha u hora no válida' };
  if (clockOutAt.getTime() === clockInAt.getTime()) return { error: 'La salida debe ser posterior a la entrada' };
  if (clockOutAt < clockInAt) clockOutAt.setDate(clockOutAt.getDate() + 1);

  const minutos = Number(form.pausaMinutos || '0');
  if (!Number.isInteger(minutos) || minutos < 0) return { error: 'Las pausas deben ser minutos enteros, 0 o más' };
  const breakSeconds = minutos * 60;
  const span = (clockOutAt.getTime() - clockInAt.getTime()) / 1000;
  if (breakSeconds >= span) return { error: 'La pausa no puede ser igual o mayor que la sesión' };

  const reason = form.motivo.trim();
  if (reason.length < 5) return { error: 'Indica el motivo de la corrección (mínimo 5 caracteres)' };

  return { correction: { clockInAt, clockOutAt, breakSeconds, reason } };
}
