// Buscadores de productos: sin tildes ni mayúsculas, y cada palabra por separado
// («paris» encuentra «Sandalia París Gris»; «sandalia gris», también).

/** Texto para comparar: sin tildes (también ñ → n) y en minúsculas. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** ¿Están todas las palabras de la búsqueda en alguno de los campos? Sin búsqueda, sí. */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fields.filter(Boolean).map((f) => normalizeSearch(f as string)).join(' ');
  return words.every((w) => text.includes(w));
}
