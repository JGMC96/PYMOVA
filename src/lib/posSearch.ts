// Buscador del TPV: además del producto mira sus tallas (nombre, SKU, código de barras y
// atributos), para que «zueco denia 38» o el SKU de una talla encuentren lo que se busca.
import { normalizeSearch } from './search';

/** Resultados que enseña el desplegable del TPV; el resto, en el catálogo. */
export const POS_SEARCH_LIMIT = 20;

export interface PosSearchVariant {
  name: string;
  sku: string | null;
  barcode: string | null;
  attributes?: Record<string, string> | null;
  stock_quantity: number;
}

export interface PosSearchProduct<V extends PosSearchVariant = PosSearchVariant> {
  name: string;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  color?: string | null;
  variants: V[];
}

export interface PosSearchHit<P extends PosSearchProduct> {
  product: P;
  /** La talla concreta, cuando la búsqueda señala solo una. */
  variant: P['variants'][number] | null;
  /** Coincide exactamente con un código de barras o un SKU. */
  exactCode: boolean;
}

const joined = (fields: (string | null | undefined)[]) =>
  fields.filter(Boolean).map((f) => normalizeSearch(f as string)).join(' ');

const sameCode = (code: string, value: string | null | undefined) =>
  !!value && normalizeSearch(value) === code;

/** Producto (o talla) cuyo código de barras o SKU es exactamente `code`, sin mayúsculas. */
export function findByCode<P extends PosSearchProduct>(
  products: P[],
  code: string,
): PosSearchHit<P> | null {
  const c = normalizeSearch(code);
  if (!c) return null;
  for (const product of products) {
    const variant = product.variants.find((v) => sameCode(c, v.barcode) || sameCode(c, v.sku));
    if (variant) return { product, variant, exactCode: true };
    if (sameCode(c, product.barcode) || sameCode(c, product.sku)) {
      return { product, variant: null, exactCode: true };
    }
  }
  return null;
}

/**
 * Productos que encajan con la búsqueda, uno por producto y en este orden: código exacto,
 * nombre que empieza por lo escrito y el resto (en el orden recibido). Cada palabra puede
 * estar en el producto o en una de sus tallas. Sin búsqueda, todos.
 */
export function searchPosProducts<P extends PosSearchProduct>(
  products: P[],
  query: string,
): PosSearchHit<P>[] {
  const q = normalizeSearch(query);
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return products.map((product) => ({ product, variant: null, exactCode: false }));

  const ranked: { hit: PosSearchHit<P>; rank: number }[] = [];
  for (const product of products) {
    const exact = findByCode([product], q);
    if (exact) {
      ranked.push({ hit: exact, rank: 0 });
      continue;
    }

    const productText = joined([product.name, product.category, product.sku, product.barcode, product.color]);
    const missing = words.filter((w) => !productText.includes(w));
    const rank = normalizeSearch(product.name).startsWith(q) ? 1 : 2;
    if (missing.length === 0) {
      ranked.push({ hit: { product, variant: null, exactCode: false }, rank });
      continue;
    }

    const variants = product.variants.filter((v) => {
      const text = joined([v.name, v.sku, v.barcode, ...Object.values(v.attributes ?? {})]);
      return missing.every((w) => text.includes(w));
    });
    if (variants.length > 0) {
      // «38» también está en el SKU de otras tallas: si una se llama así, es esa.
      const byName = variants.filter((v) => missing.includes(normalizeSearch(v.name)));
      const one = variants.length === 1 ? variants[0] : byName.length === 1 ? byName[0] : null;
      ranked.push({ hit: { product, variant: one, exactCode: false }, rank });
    }
  }

  // sort es estable: dentro de cada grupo se mantiene el orden de `products` (por nombre).
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.hit);
}
