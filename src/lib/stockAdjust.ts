// Motivos de un ajuste manual de stock. El texto final se guarda en el historial.

export const STOCK_ADJUST_REASONS = ['Recuento', 'Entrada de mercancía', 'Rotura o defecto', 'Otro'] as const;

/** Motivo + nota → texto para adjust_stock. «Otro» exige nota. Devuelve null si falta. */
export function buildAdjustReason(reason: string, note: string): string | null {
  const cleanNote = note.trim();
  if (reason === 'Otro') return cleanNote.length >= 3 ? cleanNote : null;
  return cleanNote ? `${reason}: ${cleanNote}` : reason;
}
