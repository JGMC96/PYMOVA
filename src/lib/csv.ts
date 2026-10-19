// Exportación a CSV sin inyección de fórmulas (CWE-1236).
// Excel y LibreOffice ejecutan una celda que empieza por =, +, -, @, tab o retorno
// de carro; se neutraliza con una comilla simple delante, como recomienda OWASP.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Celda de texto: comillas dobles escapadas y prefijo neutralizado. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Fila CSV: los números van tal cual y los textos con csvCell. */
export function csvRow(values: unknown[]): string {
  return values.map((v) => (typeof v === 'number' ? String(v) : csvCell(v))).join(',');
}
