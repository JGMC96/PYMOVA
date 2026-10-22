// Códigos para productos nuevos (0043): SKU con el formato del negocio, como en Stockagile
// (T{TEMPORADA}{TIPO}{MODELO}{COLOR}{TALLA}, p. ej. TFW26ZU004NE38). Solo propone: el servidor
// reserva y comprueba que no se repitan, y nunca cambia un código que ya existe.

export const DEFAULT_SKU_PATTERN = 'T{TEMPORADA}{TIPO}{MODELO}{COLOR}{TALLA}';

export interface SkuParts {
  temporada: string;
  tipo: string;
  modelo: string;
  color: string;
  talla: string;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clean = (s: string) => stripAccents(s).replace(/[^A-Za-z0-9._-]/g, '');

/** Temporada por la fecha: de enero a junio, primavera-verano (SS); de julio a diciembre, otoño-invierno (FW). */
export function seasonCode(date = new Date()): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  return `${date.getMonth() < 6 ? 'SS' : 'FW'}${yy}`;
}

const TYPE_CODES: [RegExp, string][] = [
  [/^botin/, 'BO'],
  [/^sandalia/, 'Sand'],
  [/^zueco/, 'ZU'],
  [/^mocasin/, 'MO'],
  [/^nautico/, 'NA'],
  [/^calcet/, 'CA'],
];

/** Tipo por la primera palabra del nombre (Zueco → ZU, Botín → BO, Sandalia → Sand). */
export function typeCode(productName: string): string {
  const name = stripAccents(productName.trim().toLowerCase());
  return TYPE_CODES.find(([re]) => re.test(name))?.[1] ?? '';
}

/** Siguiente número de modelo (3 cifras) para esa temporada y tipo, mirando los SKU que ya existen. */
export function nextModelNumber(existingSkus: (string | null | undefined)[], temporada: string, tipo: string): string {
  if (!temporada || !tipo) return '001';
  const prefix = `T${temporada}${tipo}`.toUpperCase();
  let max = 0;
  for (const sku of existingSkus) {
    const s = (sku ?? '').toUpperCase();
    if (!s.startsWith(prefix)) continue;
    const m = /^(\d{3})/.exec(s.slice(prefix.length));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(3, '0');
}

// Códigos de color que ya usa Tuilus en sus SKU (por la última palabra del color).
const COLOR_CODES: Record<string, string> = {
  negro: 'NE', chocolate: 'CH', caramelo: 'CA', vison: 'VIS', cow: 'COW', conac: 'CO', cuero: 'CU',
  desierto: 'DE', humo: 'HU', kaki: 'KA', leopardo: 'Leopardo', marino: 'MA', mostaza: 'MOS',
  pantera: 'Pantera', salmon: 'SA', tabaco: 'TA', topo: 'TO', oliva: 'VEO', burdeos: 'BU',
  amarillo: 'AM', beige: 'BE', gris: 'GR', arena: 'AR', fresa: 'FR', oro: 'OR', mandarina: 'MA',
  crema: 'CR', taupe: 'TAU', horchata: 'HOR', marron: 'MAR', blanco: 'BL', rojo: 'RO', azul: 'AZ',
  verde: 'VE', rosa: 'RS', nata: 'NA', almendra: 'ALM', tierra: 'TI',
};

/** Código de color: los que ya usa Tuilus, o las dos primeras letras de la última palabra. */
export function colorCode(color: string | null | undefined): string {
  const words = stripAccents(color ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const last = words[words.length - 1];
  return COLOR_CODES[last] ?? clean(last).slice(0, 2).toUpperCase();
}

/** Talla de la variante: su atributo «Talla» o, si no tiene, el nombre. */
export function sizeCode(variant: { name: string; attributes?: Record<string, string> | null }): string {
  const attrs = variant.attributes ?? {};
  const key = Object.keys(attrs).find((k) => stripAccents(k).toLowerCase() === 'talla');
  return clean(key ? attrs[key] : variant.name);
}

/** SKU con el formato del negocio; quita espacios y caracteres que no admite. */
export function buildSku(pattern: string, parts: SkuParts): string {
  const out = (pattern || DEFAULT_SKU_PATTERN)
    .replace(/\{TEMPORADA\}/g, parts.temporada)
    .replace(/\{TIPO\}/g, parts.tipo)
    .replace(/\{MODELO\}/g, parts.modelo)
    .replace(/\{COLOR\}/g, parts.color)
    .replace(/\{TALLA\}/g, parts.talla);
  return clean(out).slice(0, 64);
}

const hasValue = (v: string | null | undefined) => Boolean(v && v.trim());

export interface CodeVariant {
  id: string;
  name: string;
  attributes?: Record<string, string> | null;
  sku: string | null;
  barcode: string | null;
  is_active?: boolean;
}

export interface PlannedCode {
  variant: CodeVariant;
  sku: string | null;
  barcode: 'auto' | null;
  /** Por qué no se puede poner (SKU repetido, vacío...). */
  problem: string | null;
}

/**
 * Plan de códigos de un producto: solo para las tallas sin SKU o sin código de barras. Marca
 * los SKU repetidos (entre sí o con otros productos) para que no se puedan guardar.
 */
export function planCodes(
  variants: CodeVariant[],
  options: { pattern: string; parts: Omit<SkuParts, 'talla'>; withSku: boolean; withBarcode: boolean },
  existingSkus: (string | null | undefined)[],
): PlannedCode[] {
  const taken = new Set(existingSkus.filter(hasValue).map((s) => (s as string).trim().toUpperCase()));
  const seen = new Set<string>();
  const plan: PlannedCode[] = [];
  for (const variant of variants) {
    if (variant.is_active === false) continue;
    const needSku = options.withSku && !hasValue(variant.sku);
    const needBarcode = options.withBarcode && !hasValue(variant.barcode);
    if (!needSku && !needBarcode) continue;
    let sku: string | null = null;
    let problem: string | null = null;
    if (needSku) {
      sku = buildSku(options.pattern, { ...options.parts, talla: sizeCode(variant) });
      const key = sku.toUpperCase();
      if (!sku) problem = 'SKU vacío';
      else if (taken.has(key) || seen.has(key)) problem = 'SKU repetido';
      seen.add(key);
    }
    plan.push({ variant, sku, barcode: needBarcode ? 'auto' : null, problem });
  }
  return plan;
}

/** ¿Le falta a alguna talla activa el SKU o el código de barras? */
export function needsCodes(variants: CodeVariant[]): boolean {
  return variants.some((v) => v.is_active !== false && (!hasValue(v.sku) || !hasValue(v.barcode)));
}
