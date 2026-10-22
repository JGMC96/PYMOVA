// Códigos para productos nuevos: lo que se manda a Shopify. Sin dependencias de Deno para probarlo.

export interface ReservedCode {
  variant_id: string;
  variant_external_id: string | null;
  product_external_id: string | null;
  sku: string | null;
  barcode: string | null;
}

export interface ShopifyVariantCodes {
  id: string;
  sku: string | null;
  barcode: string | null;
}

export interface CodeRequest {
  variant_id: string;
  external_id: string | null;
  sku?: string | null;
  barcode?: string | null;
}

const filled = (v: string | null | undefined) => Boolean(v && v.trim());

/** Tallas a las que se quiere poner un código que Shopify ya tiene: nunca se cambia. */
export function shopifyCodeConflicts(requests: CodeRequest[], shopify: ShopifyVariantCodes[]): string[] {
  const byId = new Map(shopify.map((v) => [v.id, v]));
  const conflicts: string[] = [];
  for (const r of requests) {
    const current = r.external_id ? byId.get(r.external_id) : undefined;
    if (!current) continue;
    if ((filled(r.sku) && filled(current.sku)) || (filled(r.barcode) && filled(current.barcode))) {
      conflicts.push(r.variant_id);
    }
  }
  return conflicts;
}

/** Entrada de productVariantsBulkUpdate: solo los campos que se rellenan. */
export function variantCodeUpdates(rows: ReservedCode[]) {
  return rows
    .filter((r) => r.variant_external_id && (r.sku || r.barcode))
    .map((r) => ({
      id: r.variant_external_id as string,
      ...(r.barcode ? { barcode: r.barcode } : {}),
      ...(r.sku ? { inventoryItem: { sku: r.sku } } : {}),
    }));
}
