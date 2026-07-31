// Cliente de catálogo de Shopify.
// Todas las llamadas pasan por la Edge Function `shopify-sync`: el token de la
// app vive únicamente en el backend, nunca en el navegador.
import { supabase } from '@/integrations/supabase/client';

export const SHOPIFY_API_VERSION = '2026-07';

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: { amount: string; currencyCode: string };
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { edges: Array<{ node: ShopifyVariant }> };
}

export interface ShopifyProductsPage {
  products: ShopifyProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Invoca `shopify-sync` y normaliza los errores devueltos por el backend. */
export async function invokeShopifySync<T = unknown>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('shopify-sync', { body });

  if (error) {
    let message = error.message;
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.clone().json();
        if (payload?.error) message = payload.error;
      } catch {
        // Sin cuerpo JSON: se conserva el mensaje original.
      }
    }
    throw new Error(message);
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: string }).error));
  }

  return data as T;
}

export async function fetchShopifyProducts(
  businessId: string,
  options: { first?: number; after?: string | null; query?: string } = {},
): Promise<ShopifyProductsPage> {
  return await invokeShopifySync<ShopifyProductsPage>({
    action: 'list-products',
    business_id: businessId,
    first: options.first ?? 50,
    after: options.after ?? null,
    query: options.query?.trim() || null,
  });
}

export async function fetchAllShopifyProducts(
  businessId: string,
  query?: string,
  onProgress?: (loaded: number) => void,
  maxPages = 20,
): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchShopifyProducts(businessId, { first: 100, after, query });
    all.push(...page.products);
    onProgress?.(all.length);
    if (!page.hasNextPage || !page.endCursor) break;
    after = page.endCursor;
  }
  return all;
}
