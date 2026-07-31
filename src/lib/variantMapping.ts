import type { ShopifyProduct } from '@/lib/shopify';

export type MismatchCode =
  | 'missing_sku'
  | 'duplicate_sku'
  | 'unmatched_variant'
  | 'orphan_local_variant'
  | 'stock_not_tracked'
  | 'stock_mismatch';

export const MISMATCH_LABELS: Record<MismatchCode, string> = {
  missing_sku: 'Sin SKU ni código de barras',
  duplicate_sku: 'SKU duplicado',
  unmatched_variant: 'Sin equivalencia en Pymova',
  orphan_local_variant: 'Variante local sin equivalencia en Shopify',
  stock_not_tracked: 'Shopify no expone stock',
  stock_mismatch: 'Stock distinto',
};

export const MISMATCH_HINTS: Record<MismatchCode, string> = {
  missing_sku:
    'Añade un SKU o código de barras en Shopify para poder emparejar la variante de forma fiable.',
  duplicate_sku:
    'Dos o más variantes comparten el mismo SKU: el stock puede aplicarse a la variante equivocada.',
  unmatched_variant:
    'La variante existe en Shopify pero no en Pymova. Lánzala con «Forzar sincronización» para crearla.',
  orphan_local_variant:
    'La variante existe en Pymova pero ya no está en Shopify: su stock nunca se actualizará.',
  stock_not_tracked:
    'Shopify no devuelve inventario para esta variante (seguimiento desactivado o sin permiso de lectura de inventario).',
  stock_mismatch: 'El stock de Shopify y el de Pymova no coinciden tras la última sincronización.',
};

export interface LocalVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock_quantity: number;
  external_id: string | null;
}

export interface VariantMismatch {
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  barcode: string | null;
  external_id: string | null;
  local_variant_id: string | null;
  issue_code: MismatchCode;
  external_stock: number | null;
  local_stock: number | null;
  details: string;
}

const norm = (value?: string | null) => (value ? value.trim().toLowerCase() : '');

/** Índice de variantes locales por identificador externo, SKU, código de barras y nombre. */
export function buildVariantIndex(variants: LocalVariant[]) {
  const byExternal = new Map<string, LocalVariant>();
  const bySku = new Map<string, LocalVariant>();
  const byBarcode = new Map<string, LocalVariant>();
  const byName = new Map<string, LocalVariant>();

  for (const variant of variants) {
    if (variant.external_id) byExternal.set(variant.external_id, variant);
    if (norm(variant.sku)) bySku.set(norm(variant.sku), variant);
    if (norm(variant.barcode)) byBarcode.set(norm(variant.barcode), variant);
    byName.set(norm(variant.name), variant);
  }

  return { byExternal, bySku, byBarcode, byName };
}

export type VariantIndex = ReturnType<typeof buildVariantIndex>;

export interface MatchResult {
  variant: LocalVariant | null;
  matchedBy: 'external_id' | 'sku' | 'barcode' | 'name' | null;
}

/** Empareja una variante de Shopify con una local: externalId > SKU > código de barras > nombre. */
export function matchVariant(
  index: VariantIndex,
  candidate: { externalId?: string | null; sku?: string | null; barcode?: string | null; name: string },
): MatchResult {
  if (candidate.externalId) {
    const hit = index.byExternal.get(candidate.externalId);
    if (hit) return { variant: hit, matchedBy: 'external_id' };
  }
  if (norm(candidate.sku)) {
    const hit = index.bySku.get(norm(candidate.sku));
    if (hit) return { variant: hit, matchedBy: 'sku' };
  }
  if (norm(candidate.barcode)) {
    const hit = index.byBarcode.get(norm(candidate.barcode));
    if (hit) return { variant: hit, matchedBy: 'barcode' };
  }
  const byName = index.byName.get(norm(candidate.name));
  if (byName) return { variant: byName, matchedBy: 'name' };
  return { variant: null, matchedBy: null };
}

/** Compara un producto de Shopify con las variantes locales y devuelve los desajustes detectados. */
export function auditProductVariants(
  product: ShopifyProduct,
  localVariants: LocalVariant[],
): VariantMismatch[] {
  const mismatches: VariantMismatch[] = [];
  const shopifyVariants = product.variants.edges.map((e) => e.node);
  const index = buildVariantIndex(localVariants);
  const matchedLocalIds = new Set<string>();

  const skuCounts = new Map<string, number>();
  for (const variant of shopifyVariants) {
    const key = norm(variant.sku);
    if (key) skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
  }

  for (const variant of shopifyVariants) {
    const base = {
      product_name: product.title,
      variant_name: variant.title,
      sku: variant.sku || null,
      barcode: variant.barcode || null,
      external_id: variant.id,
    };

    if (!norm(variant.sku) && !norm(variant.barcode)) {
      mismatches.push({
        ...base,
        local_variant_id: null,
        issue_code: 'missing_sku',
        external_stock: typeof variant.quantityAvailable === 'number' ? variant.quantityAvailable : null,
        local_stock: null,
        details: MISMATCH_HINTS.missing_sku,
      });
    } else if ((skuCounts.get(norm(variant.sku)) ?? 0) > 1) {
      mismatches.push({
        ...base,
        local_variant_id: null,
        issue_code: 'duplicate_sku',
        external_stock: typeof variant.quantityAvailable === 'number' ? variant.quantityAvailable : null,
        local_stock: null,
        details: `${MISMATCH_HINTS.duplicate_sku} (SKU ${variant.sku}).`,
      });
    }

    const { variant: local, matchedBy } = matchVariant(index, {
      externalId: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      name: variant.title,
    });

    if (!local) {
      mismatches.push({
        ...base,
        local_variant_id: null,
        issue_code: 'unmatched_variant',
        external_stock: typeof variant.quantityAvailable === 'number' ? variant.quantityAvailable : null,
        local_stock: null,
        details: MISMATCH_HINTS.unmatched_variant,
      });
      continue;
    }

    matchedLocalIds.add(local.id);

    if (typeof variant.quantityAvailable !== 'number') {
      mismatches.push({
        ...base,
        local_variant_id: local.id,
        issue_code: 'stock_not_tracked',
        external_stock: null,
        local_stock: local.stock_quantity,
        details: MISMATCH_HINTS.stock_not_tracked,
      });
    } else if (variant.quantityAvailable !== local.stock_quantity) {
      mismatches.push({
        ...base,
        local_variant_id: local.id,
        issue_code: 'stock_mismatch',
        external_stock: variant.quantityAvailable,
        local_stock: local.stock_quantity,
        details: `${MISMATCH_HINTS.stock_mismatch} Emparejada por ${matchedBy}.`,
      });
    }
  }

  for (const local of localVariants) {
    if (matchedLocalIds.has(local.id)) continue;
    mismatches.push({
      product_name: product.title,
      variant_name: local.name,
      sku: local.sku,
      barcode: local.barcode,
      external_id: local.external_id,
      local_variant_id: local.id,
      issue_code: 'orphan_local_variant',
      external_stock: null,
      local_stock: local.stock_quantity,
      details: MISMATCH_HINTS.orphan_local_variant,
    });
  }

  return mismatches;
}
