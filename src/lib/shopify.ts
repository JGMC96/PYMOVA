import { toast } from 'sonner';

export const SHOPIFY_API_VERSION = '2025-07';
export const SHOPIFY_STORE_PERMANENT_DOMAIN = 'tuilus-shop.myshopify.com';
export const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
export const SHOPIFY_STOREFRONT_TOKEN = '180aab18cd428450b8cc8b6835f9ad31';

export interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  quantityAvailable: number | null;
  availableForSale: boolean;
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
  totalInventory: number | null;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { edges: Array<{ node: ShopifyVariant }> };
}

export interface ShopifyProductsPage {
  products: ShopifyProduct[];
  hasNextPage: boolean;
  endCursor: string | null;
}

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          description
          productType
          vendor
          totalInventory
          featuredImage { url altText }
          priceRange { minVariantPrice { amount currencyCode } }
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                barcode
                quantityAvailable
                availableForSale
                price { amount currencyCode }
                selectedOptions { name value }
              }
            }
          }
        }
      }
    }
  }
`;

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    toast.error('Shopify: se requiere un plan activo', {
      description:
        'El acceso a la API de Shopify necesita una suscripción activa. Actualiza tu plan en admin.shopify.com.',
    });
    return null;
  }

  if (!response.ok) {
    throw new Error(`Error HTTP de Shopify: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(
      `Error de Shopify: ${data.errors.map((e: { message: string }) => e.message).join(', ')}`,
    );
  }

  return data;
}

export async function fetchShopifyProducts(
  options: { first?: number; after?: string | null; query?: string } = {},
): Promise<ShopifyProductsPage> {
  const data = await storefrontApiRequest(PRODUCTS_QUERY, {
    first: options.first ?? 50,
    after: options.after ?? null,
    query: options.query?.trim() || null,
  });

  const connection = data?.data?.products;
  if (!connection) {
    return { products: [], hasNextPage: false, endCursor: null };
  }

  return {
    products: connection.edges.map((edge: { node: ShopifyProduct }) => edge.node),
    hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
    endCursor: connection.pageInfo?.endCursor ?? null,
  };
}
