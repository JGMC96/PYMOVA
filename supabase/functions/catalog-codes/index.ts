// Pone EAN-13 y SKU a las tallas de un producto nuevo que no los tienen, en PYMOVA y en Shopify.
// Nunca cambia un código existente (ni en PYMOVA ni en Shopify). Los códigos los reserva
// reserve_catalog_codes (permiso de catálogo; bloqueado mientras Stockagile esté conectado).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getShopDomain, serviceClient, shopifyGraphql, ShopifyError } from '../_shared/shopify-client.ts';
import { storeConnection } from '../_shared/shopify-connection.ts';
import {
  shopifyCodeConflicts, variantCodeUpdates, type ReservedCode, type ShopifyVariantCodes,
} from '../_shared/catalog-codes.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const UUID = /^[0-9a-f-]{36}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const VARIANT_CODES_QUERY = `
  query VariantCodes($id: ID!) {
    product(id: $id) { variants(first: 250) { nodes { id sku barcode } } }
  }
`;

const SET_CODES = `
  mutation SetVariantCodes($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku barcode }
      userErrors { field message }
    }
  }
`;

interface Item {
  variant_id: string;
  sku?: string | null;
  barcode?: 'auto' | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const body = (await req.json().catch(() => ({}))) ?? {};
    const businessId = String(body.business_id ?? '');
    const productId = String(body.product_id ?? '');
    if (!UUID.test(businessId)) return json({ error: 'Falta el negocio activo' }, 400);
    if (!UUID.test(productId)) return json({ error: 'Falta el producto' }, 400);
    const items: Item[] = Array.isArray(body.items)
      ? body.items
        .filter((i: Item) => i && UUID.test(String(i.variant_id)))
        .map((i: Item) => ({
          variant_id: String(i.variant_id),
          sku: typeof i.sku === 'string' && i.sku.trim() ? i.sku.trim() : null,
          barcode: i.barcode === 'auto' ? 'auto' : null,
        }))
      : [];
    if (items.length === 0 || items.length > 200) return json({ error: 'No hay tallas a las que poner código' }, 400);
    const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
    if (!isMember) return json({ error: 'Sin acceso a este negocio' }, 403);

    const admin = serviceClient();
    const { data: product } = await admin
      .from('products').select('id, external_id, external_source')
      .eq('id', productId).eq('business_id', businessId).maybeSingle();
    if (!product) return json({ error: 'Producto no encontrado' }, 404);
    const shopifyProduct = product.external_source === 'shopify' && product.external_id ? String(product.external_id) : null;
    // Solo escribe en Shopify el negocio vinculado a la tienda de este despliegue (S1/S4).
    if (shopifyProduct && !(await storeConnection(admin, businessId, getShopDomain(), 'business_id'))) {
      return json({ error: 'Este negocio no tiene la tienda de Shopify vinculada' }, 409);
    }

    // Lo que hay en Shopify manda: si una talla ya tiene ese código allí, no se toca.
    if (shopifyProduct) {
      const { data: variants } = await admin
        .from('product_variants').select('id, external_id, name')
        .eq('product_id', productId).in('id', items.map((i) => i.variant_id));
      const extById = new Map((variants ?? []).map((v) => [v.id, v.external_id as string | null]));
      if (items.some((i) => !extById.get(i.variant_id))) {
        return json({ error: 'Una talla aún no está en Shopify: sincroniza el catálogo y vuelve a intentarlo' }, 409);
      }
      const current = await shopifyGraphql<{ product: { variants: { nodes: ShopifyVariantCodes[] } } | null }>(
        VARIANT_CODES_QUERY, { id: shopifyProduct },
      );
      if (!current.product) return json({ error: 'El producto ya no está en Shopify' }, 409);
      const conflicts = shopifyCodeConflicts(
        items.map((i) => ({ variant_id: i.variant_id, external_id: extById.get(i.variant_id) ?? null, sku: i.sku, barcode: i.barcode })),
        current.product.variants.nodes,
      );
      if (conflicts.length) {
        const names = (variants ?? []).filter((v) => conflicts.includes(v.id)).map((v) => v.name).join(', ');
        return json({ error: `En Shopify ya tienen código: ${names}. Sincroniza el catálogo; no se cambia.` }, 409);
      }
    }

    const { data: reserved, error: reserveError } = await userClient.rpc('reserve_catalog_codes', {
      _business_id: businessId, _product_id: productId, _items: items,
    });
    if (reserveError) {
      return json({ error: reserveError.message }, reserveError.code === '42501' ? 403 : 400);
    }
    const rows = (reserved ?? []) as ReservedCode[];

    if (shopifyProduct) {
      const result = await shopifyGraphql<{
        productVariantsBulkUpdate: { userErrors: { field: string[] | null; message: string }[] };
      }>(SET_CODES, { productId: shopifyProduct, variants: variantCodeUpdates(rows) });
      const errors = result.productVariantsBulkUpdate.userErrors;
      if (errors.length) {
        return json({ error: `Shopify no ha guardado los códigos: ${errors.map((e) => e.message).join('; ')}` }, 502);
      }
    }

    // Copia local, solo donde sigue vacío (la sincronización de Shopify traerá lo mismo).
    for (const r of rows) {
      if (r.sku) {
        await admin.from('product_variants').update({ sku: r.sku }).eq('id', r.variant_id).or('sku.is.null,sku.eq.');
      }
      if (r.barcode) {
        await admin.from('product_variants').update({ barcode: r.barcode }).eq('id', r.variant_id).or('barcode.is.null,barcode.eq.');
      }
    }
    return json({ status: 'ok', codes: rows.map(({ variant_id, sku, barcode }) => ({ variant_id, sku, barcode })) });
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, status);
  }
});
