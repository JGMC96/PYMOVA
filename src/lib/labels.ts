// Etiquetas de producto (0042), como el diseñador de Stockagile: un diseño con la hoja (A4 por
// filas y columnas, o rollo de una etiqueta por página) y los campos (nombre, color, talla,
// precio, SKU, código de barras y texto libre) con tamaño, alineación, estilos y orden.
import { code128Svg } from './barcode';
import { ean13Svg, isValidEan13 } from './ean13';

export type LabelFieldKind = 'name' | 'color' | 'size' | 'price' | 'sku' | 'barcode' | 'text';
export type Align = 'left' | 'center' | 'right';
export type BarcodePosition = 'left' | 'top' | 'bottom' | 'right';

export interface LabelField {
  id: string;
  kind: LabelFieldKind;
  /** Tamaño del texto en puntos. */
  fontSize: number;
  align: Align;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Texto delante del valor (p. ej. «Talla», «Precio»). */
  prefix: string;
  /** Texto libre (campo 'text'). */
  text: string;
  /** Precio sin IVA (campo 'price'). */
  priceWithoutTax: boolean;
  /** Código de barras: dónde va, si lleva los números y su alto (mm; 0 = automático). */
  barcodePosition: BarcodePosition;
  barcodeNumbers: boolean;
  barcodeSizeMm: number;
}

export interface LabelSheet {
  mode: 'sheet' | 'roll';
  /** Hoja A4. */
  orientation: 'portrait' | 'landscape';
  rows: number;
  cols: number;
  pageMarginsMm: { top: number; right: number; bottom: number; left: number };
  /** Rollo: tamaño de cada etiqueta. */
  rollWidthMm: number;
  rollHeightMm: number;
  /** Margen dentro de cada etiqueta. */
  paddingMm: number;
  border: boolean;
}

export interface LabelConfig {
  version: 1;
  sheet: LabelSheet;
  fields: LabelField[];
}

export interface LabelData {
  name: string;
  color: string | null;
  size: string | null;
  /** Precio con IVA. */
  price: number | null;
  sku: string | null;
  barcode: string | null;
}

export const FIELD_LABELS: Record<LabelFieldKind, string> = {
  name: 'Nombre del producto',
  color: 'Color',
  size: 'Talla',
  price: 'Precio',
  sku: 'SKU',
  barcode: 'Código de barras',
  text: 'Texto libre',
};

export function newField(kind: LabelFieldKind, over: Partial<LabelField> = {}): LabelField {
  return {
    id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    fontSize: 10,
    align: 'left',
    bold: false,
    italic: false,
    underline: false,
    prefix: '',
    text: '',
    priceWithoutTax: false,
    barcodePosition: 'right',
    barcodeNumbers: true,
    barcodeSizeMm: 0,
    ...over,
  };
}

/** El diseño «Etiquetas OK» de Tuilus en Stockagile: A4, 3 × 8, 70 × 37,13 mm. */
export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  version: 1,
  sheet: {
    mode: 'sheet',
    orientation: 'portrait',
    rows: 8,
    cols: 3,
    pageMarginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
    rollWidthMm: 50,
    rollHeightMm: 30,
    paddingMm: 3,
    border: false,
  },
  fields: [
    newField('name', { id: 'name', fontSize: 12, italic: true }),
    newField('color', { id: 'color', fontSize: 18, italic: true }),
    newField('size', { id: 'size', fontSize: 18, align: 'center', bold: true, prefix: 'Talla' }),
    newField('price', { id: 'price', fontSize: 10, align: 'center', bold: true, prefix: 'Precio' }),
    newField('barcode', { id: 'barcode', barcodePosition: 'right', barcodeNumbers: true }),
  ],
};

const A4 = { width: 210, height: 297 };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Configuración guardada → diseño completo (lo que falte, del diseño por defecto). */
export function normalizeLabelConfig(raw: unknown): LabelConfig {
  const r = (raw ?? {}) as Partial<LabelConfig>;
  const sheet = { ...DEFAULT_LABEL_CONFIG.sheet, ...(r.sheet ?? {}) } as LabelSheet;
  sheet.pageMarginsMm = { ...DEFAULT_LABEL_CONFIG.sheet.pageMarginsMm, ...(r.sheet?.pageMarginsMm ?? {}) };
  sheet.rows = Math.min(Math.max(1, Math.floor(Number(sheet.rows) || 1)), 40);
  sheet.cols = Math.min(Math.max(1, Math.floor(Number(sheet.cols) || 1)), 10);
  const fields = Array.isArray(r.fields) ? r.fields.map((f) => newField(f.kind, f)) : DEFAULT_LABEL_CONFIG.fields;
  return { version: 1, sheet, fields };
}

/** Tamaño de cada etiqueta en mm. */
export function labelSizeMm(sheet: LabelSheet): { width: number; height: number } {
  if (sheet.mode === 'roll') return { width: sheet.rollWidthMm, height: sheet.rollHeightMm };
  const page = sheet.orientation === 'portrait' ? A4 : { width: A4.height, height: A4.width };
  const m = sheet.pageMarginsMm;
  return {
    width: round2((page.width - m.left - m.right) / sheet.cols),
    height: round2((page.height - m.top - m.bottom) / sheet.rows),
  };
}

const eur = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Texto de un campo para un artículo (vacío si no hay dato). */
export function fieldText(field: LabelField, data: LabelData, taxRate: number): string {
  let value: string | null = null;
  switch (field.kind) {
    case 'name': value = data.name; break;
    case 'color': value = data.color; break;
    case 'size': value = data.size; break;
    case 'sku': value = data.sku; break;
    case 'text': return field.text;
    case 'price':
      if (data.price == null) return '';
      value = eur(field.priceWithoutTax ? round2(data.price / (1 + taxRate / 100)) : data.price);
      break;
    default: return '';
  }
  if (!value) return '';
  return field.prefix ? `${field.prefix} ${value}` : value;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG del código: EAN-13 si lo es; si no, Code 128. Vacío si no se puede pintar. */
export function barcodeSvg(code: string | null): string {
  if (!code) return '';
  try {
    return isValidEan13(code) ? ean13Svg(code) : code128Svg(code);
  } catch {
    return '';
  }
}

/** HTML de una etiqueta (contenido; el tamaño lo pone la hoja). */
export function renderLabel(config: LabelConfig, data: LabelData, taxRate: number): string {
  const texts = config.fields
    .filter((f) => f.kind !== 'barcode')
    .map((f) => {
      const t = fieldText(f, data, taxRate);
      if (!t) return '';
      const style = [
        `font-size:${f.fontSize}pt`,
        `text-align:${f.align}`,
        f.bold ? 'font-weight:700' : '',
        f.italic ? 'font-style:italic' : '',
        f.underline ? 'text-decoration:underline' : '',
      ].filter(Boolean).join(';');
      return `<div class="lf" style="${style}">${esc(t)}</div>`;
    })
    .join('');

  const bc = config.fields.find((f) => f.kind === 'barcode');
  const svg = bc ? barcodeSvg(data.barcode) : '';
  if (!bc || !svg) return `<div class="lt">${texts}</div>`;

  const vertical = bc.barcodePosition === 'left' || bc.barcodePosition === 'right';
  const size = bc.barcodeSizeMm > 0 ? `${bc.barcodeSizeMm}mm` : vertical ? '12mm' : '9mm';
  const numbers = bc.barcodeNumbers ? `<div class="bn">${esc(data.barcode ?? '')}</div>` : '';
  const code = vertical
    ? `<div class="bv" style="width:${size}"><div class="bvr">${svg}${numbers}</div></div>`
    : `<div class="bh" style="height:${size}">${svg}</div>${numbers}`;
  const dir = { right: 'row', left: 'row-reverse', bottom: 'column', top: 'column-reverse' }[bc.barcodePosition];
  return `<div class="lw" style="flex-direction:${dir}"><div class="lt">${texts}</div>${vertical ? code : `<div class="lb">${code}</div>`}</div>`;
}

/** Una fila por artículo y cantidad → lista de etiquetas, con huecos al principio (posición de inicio). */
export function expandLabels<T>(rows: { data: T; quantity: number }[], startAt = 1): (T | null)[] {
  const blanks = Math.max(0, Math.floor(startAt) - 1);
  const out: (T | null)[] = Array.from({ length: blanks }, () => null);
  for (const r of rows) for (let i = 0; i < Math.max(0, Math.floor(r.quantity)); i++) out.push(r.data);
  return out;
}

export function labelStyles(config: LabelConfig): string {
  const { width, height } = labelSizeMm(config.sheet);
  const s = config.sheet;
  const page = s.mode === 'roll'
    ? `@page{size:${s.rollWidthMm}mm ${s.rollHeightMm}mm;margin:0}`
    : `@page{size:A4 ${s.orientation};margin:0}`;
  return `${page}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
  .page{display:grid;grid-template-columns:repeat(${s.mode === 'roll' ? 1 : s.cols},${width}mm);grid-auto-rows:${height}mm;
    padding:${s.mode === 'roll' ? '0' : `${s.pageMarginsMm.top}mm ${s.pageMarginsMm.right}mm ${s.pageMarginsMm.bottom}mm ${s.pageMarginsMm.left}mm`};
    break-after:page;page-break-after:always}
  .page:last-child{break-after:auto;page-break-after:auto}
  .label{width:${width}mm;height:${height}mm;padding:${s.paddingMm}mm;overflow:hidden;${s.border ? 'border:0.2mm solid #999;' : ''}}
  .lw{display:flex;height:100%;gap:1.5mm}
  .lt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.4mm;line-height:1.1;overflow:hidden}
  .lf{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lb{display:flex;flex-direction:column;align-items:center}
  .bh{width:100%}.bh svg{width:100%;height:100%;display:block}
  .bn{font-size:6pt;text-align:center;letter-spacing:0.5px;font-family:'Courier New',monospace}
  .bv{position:relative;height:100%;flex:none}
  .bvr{position:absolute;top:50%;left:50%;width:${height - s.paddingMm * 2}mm;transform:translate(-50%,-50%) rotate(90deg)}
  .bvr svg{width:100%;height:9mm;display:block}`;
}

/** Páginas con las etiquetas (null = hueco en blanco). */
export function renderLabelPages(config: LabelConfig, labels: (LabelData | null)[], taxRate: number): string {
  const perPage = config.sheet.mode === 'roll' ? 1 : config.sheet.rows * config.sheet.cols;
  const pages: string[] = [];
  for (let i = 0; i < labels.length; i += perPage) {
    const cells = labels
      .slice(i, i + perPage)
      .map((d) => `<div class="label">${d ? renderLabel(config, d, taxRate) : ''}</div>`)
      .join('');
    pages.push(`<div class="page">${cells}</div>`);
  }
  return pages.join('');
}

/** Imprime (o guarda en PDF) las etiquetas en un iframe oculto. */
export function printLabels(config: LabelConfig, labels: (LabelData | null)[], taxRate: number) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title>
    <style>${labelStyles(config)}</style></head><body>${renderLabelPages(config, labels, taxRate)}</body></html>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(html);
  d.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 100);
}

/** Datos de la etiqueta de un producto (o de una de sus tallas). */
export function labelDataFor(
  product: { name: string; color?: string | null; price: number | null; sku?: string | null; barcode?: string | null },
  variant?: { name: string; attributes?: Record<string, string> | null; price: number | null; sku: string | null; barcode: string | null } | null,
): LabelData {
  const attrs = variant?.attributes ?? {};
  return {
    name: product.name,
    color: attrs.Color || attrs.color || product.color || null,
    size: variant ? attrs.Talla || attrs.talla || variant.name || null : null,
    price: variant?.price ?? product.price ?? null,
    sku: variant ? variant.sku : product.sku ?? null,
    barcode: variant ? variant.barcode : product.barcode ?? null,
  };
}

/** Orden de impresión: como se añadieron, o por producto y talla (35 < 36 < … < 41). */
export type LabelOrder = 'added' | 'product';

export function sortLabelRows<T extends { data: LabelData }>(rows: T[], order: LabelOrder): T[] {
  if (order === 'added') return rows;
  const cmp = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'es', { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => cmp(a.data.name, b.data.name) || cmp(a.data.size, b.data.size));
}

/** Etiqueta en la que empieza la siguiente impresión en la misma hoja (1 si se acaba justo). */
export function nextStartPosition(start: number, printed: number, perPage: number): number {
  if (perPage <= 1) return 1;
  return ((Math.max(1, start) - 1 + Math.max(0, printed)) % perPage) + 1;
}

const START_KEY = 'pymova_label_start';

/** Posición de inicio guardada en este ordenador para un diseño (hojas A4 empezadas). */
export function loadStartPosition(templateKey: string): number {
  try {
    const raw = JSON.parse(localStorage.getItem(START_KEY) ?? '{}') as Record<string, number>;
    const n = Math.floor(Number(raw[templateKey]));
    return n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

export function saveStartPosition(templateKey: string, position: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(START_KEY) ?? '{}') as Record<string, number>;
    raw[templateKey] = position;
    localStorage.setItem(START_KEY, JSON.stringify(raw));
  } catch {
    // Sin almacenamiento local: se empieza en la 1.
  }
}
