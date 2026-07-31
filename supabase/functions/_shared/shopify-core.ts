// Núcleo puro de la integración con Shopify.
// Sin dependencias de Deno ni de Supabase: todo se inyecta.
// Esto permite ejecutar pruebas reales (token, 401, HMAC, paginación, inventario).

export const SHOPIFY_API_VERSION = '2026-07';

export const READ_SCOPES = [
  'read_products',
  'read_inventory',
  'read_locations',
  'read_orders',
  'read_customers',
  'read_fulfillments',
] as const;

/** Margen de seguridad para renovar el token antes de que caduque. */
export const RENEW_MARGIN_MS = 2 * 60 * 1000;

export class ShopifyError extends Error {
  status: number;
  missingScopes: string[];

  constructor(message: string, status = 500, missingScopes: string[] = []) {
    super(message);
    this.name = 'ShopifyError';
    this.status = status;
    this.missingScopes = missingScopes;
  }
}

export function normalizeShopDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// HMAC de webhooks
// ---------------------------------------------------------------------------

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verifica la firma HMAC-SHA256 (base64) que envía Shopify en cada webhook. */
export async function verifyHmacSignature(
  secret: string,
  rawBody: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!secret || !headerValue) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = new Uint8Array(signature);

  let received: Uint8Array;
  try {
    const binary = atob(headerValue.trim());
    received = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return timingSafeEqual(expected, received);
}

// ---------------------------------------------------------------------------
// Gestión de token (Client Credentials Grant)
// ---------------------------------------------------------------------------

export interface TokenRecord {
  token: string;
  scopes: string[];
  expiresAt: number | null;
}

export function isTokenUsable(record: TokenRecord | null, now = Date.now()): boolean {
  if (!record?.token) return false;
  if (!record.expiresAt) return true;
  return record.expiresAt - RENEW_MARGIN_MS > now;
}

export interface TokenManagerOptions {
  shop: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Carga el token persistido (base de datos). */
  load?: () => Promise<TokenRecord | null>;
  /** Persiste el token recién emitido. */
  persist?: (record: TokenRecord) => Promise<void>;
  now?: () => number;
}

export interface TokenManager {
  get(forceRefresh?: boolean): Promise<TokenRecord>;
  invalidate(): void;
}

export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  let memory: TokenRecord | null = null;

  async function request(): Promise<TokenRecord> {
    const response = await fetchImpl(`https://${options.shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      throw new ShopifyError(
        response.status === 401 || response.status === 403
          ? 'Shopify ha rechazado las credenciales de la aplicación PYMOVA.'
          : `Shopify no ha podido emitir el token de acceso (código ${response.status}).`,
        502,
      );
    }

    const payload = (await response.json()) as {
      access_token?: string;
      scope?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new ShopifyError('Shopify no ha devuelto un token de acceso válido.', 502);
    }

    const record: TokenRecord = {
      token: payload.access_token,
      scopes: (payload.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      expiresAt: payload.expires_in ? now() + payload.expires_in * 1000 : null,
    };
    await options.persist?.(record);
    memory = record;
    return record;
  }

  return {
    invalidate() {
      memory = null;
    },
    async get(forceRefresh = false) {
      if (!forceRefresh && isTokenUsable(memory, now())) return memory!;
      if (!forceRefresh && options.load) {
        const stored = await options.load();
        if (isTokenUsable(stored, now())) {
          memory = stored;
          return stored!;
        }
      }
      return await request();
    },
  };
}

// ---------------------------------------------------------------------------
// Ejecución de GraphQL con reintento único ante 401 y backoff ante throttling
// ---------------------------------------------------------------------------

export interface GraphqlOptions {
  requiredScopes?: readonly string[];
  maxThrottleRetries?: number;
}

export interface GraphqlRunnerOptions {
  shop: string;
  tokens: TokenManager;
  fetchImpl?: typeof fetch;
  apiVersion?: string;
  sleep?: (ms: number) => Promise<void>;
}

export function missingScopes(granted: string[], required: readonly string[]): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

export type GraphqlRunner = <T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  options?: GraphqlOptions,
) => Promise<T>;

export function createGraphqlRunner(config: GraphqlRunnerOptions): GraphqlRunner {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiVersion = config.apiVersion ?? SHOPIFY_API_VERSION;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async function run<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: GraphqlOptions = {},
  ): Promise<T> {
    const maxThrottleRetries = options.maxThrottleRetries ?? 3;
    let refreshed = false;
    let throttleAttempt = 0;

    for (;;) {
      const { token, scopes } = await config.tokens.get(refreshed);

      if (options.requiredScopes?.length && scopes.length > 0) {
        const missing = missingScopes(scopes, options.requiredScopes);
        if (missing.length > 0) {
          throw new ShopifyError(
            `Esta consulta necesita permisos adicionales en Shopify: ${missing.join(', ')}.`,
            403,
            missing,
          );
        }
      }

      const response = await fetchImpl(
        `https://${config.shop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
          body: JSON.stringify({ query, variables }),
        },
      );

      if (response.status === 401) {
        await response.text().catch(() => '');
        if (!refreshed) {
          refreshed = true;
          config.tokens.invalidate();
          continue;
        }
        throw new ShopifyError('Shopify ha rechazado la autenticación de la app PYMOVA.', 401);
      }

      if (response.status === 403) {
        await response.text().catch(() => '');
        throw new ShopifyError('Shopify ha denegado el acceso por falta de permisos.', 403);
      }

      if (response.status === 429) {
        await response.text().catch(() => '');
        if (throttleAttempt < maxThrottleRetries) {
          throttleAttempt += 1;
          await sleep(1000 * throttleAttempt);
          continue;
        }
        throw new ShopifyError('Shopify está limitando las peticiones.', 429);
      }

      if (!response.ok) {
        throw new ShopifyError(`Shopify ha devuelto un error (código ${response.status}).`, 502);
      }

      const payload = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string; extensions?: { code?: string; requiredAccess?: string } }>;
      };

      if (payload.errors?.length) {
        if (
          payload.errors.some((e) => e.extensions?.code === 'THROTTLED') &&
          throttleAttempt < maxThrottleRetries
        ) {
          throttleAttempt += 1;
          await sleep(1000 * throttleAttempt);
          continue;
        }
        const denied = payload.errors.find((e) => e.extensions?.requiredAccess);
        if (denied) {
          const scope = denied.extensions?.requiredAccess ?? '';
          throw new ShopifyError(
            `Shopify requiere el permiso «${scope}» para esta consulta.`,
            403,
            scope ? [scope] : [],
          );
        }
        const messages = Array.from(
          new Set(payload.errors.map((e) => e.message.replace(/\s+/g, ' ').trim())),
        ).slice(0, 3);
        throw new ShopifyError(`Error de Shopify: ${messages.join('. ')}`, 502);
      }

      if (!payload.data) throw new ShopifyError('Shopify no ha devuelto datos.', 502);
      return payload.data;
    }
  };
}

// ---------------------------------------------------------------------------
// Consultas de catálogo, inventario, clientes y fulfillments
// ---------------------------------------------------------------------------

export const VARIANT_FIELDS = `
  id
  title
  sku
  barcode
  price
  availableForSale
  selectedOptions { name value }
  inventoryItem {
    id
    tracked
    inventoryLevels(first: 20) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          location { id name isActive }
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }
`;

export const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          description
          productType
          vendor
          status
          updatedAt
          featuredImage { url altText }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 100) {
            pageInfo { hasNextPage endCursor }
            edges { node { ${VARIANT_FIELDS} } }
          }
        }
      }
    }
  }
`;

/** Página adicional de variantes de un producto concreto. */
export const PRODUCT_VARIANTS_PAGE_QUERY = `
  query ProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      id
      variants(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${VARIANT_FIELDS} } }
      }
    }
  }
`;

/** Página adicional de niveles de inventario de un inventory item concreto. */
export const INVENTORY_LEVELS_PAGE_QUERY = `
  query InventoryLevels($id: ID!, $after: String) {
    inventoryItem(id: $id) {
      id
      inventoryLevels(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            location { id name isActive }
            quantities(names: ["available"]) { name quantity }
          }
        }
      }
    }
  }
`;

export const CUSTOMERS_QUERY = `
  query Customers($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node { id firstName lastName email phone note updatedAt } }
    }
  }
`;

export const LOCATIONS_QUERY = `
  query { locations(first: 100) { edges { node { id name isActive } } } }
`;

export const FULFILLMENTS_QUERY = `
  query OrderFulfillments($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          displayFulfillmentStatus
          fulfillments(first: 50) {
            id
            status
            createdAt
            deliveredAt
            trackingInfo { number company url }
            fulfillmentLineItems(first: 100) { edges { node { id quantity } } }
          }
        }
      }
    }
  }
`;

export interface ShopifyInventoryLevelNode {
  location: { id: string; name: string; isActive: boolean };
  quantities: Array<{ name: string; quantity: number }>;
}

export interface ShopifyVariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: {
    id: string;
    tracked: boolean;
    inventoryLevels: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: ShopifyInventoryLevelNode }>;
    };
  } | null;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ShopifyVariantNode }>;
  };
}

export interface InventoryLevelRow {
  variant_external_id: string;
  inventory_item_gid: string;
  location_gid: string;
  location_name: string;
  available: number;
}

export function availableQuantity(node: ShopifyInventoryLevelNode): number {
  return node.quantities.find((q) => q.name === 'available')?.quantity ?? 0;
}

/** Convierte los niveles de inventario de una variante en filas por ubicación. */
export function inventoryRowsForVariant(
  variant: ShopifyVariantNode,
  extraLevels: ShopifyInventoryLevelNode[] = [],
): InventoryLevelRow[] {
  const item = variant.inventoryItem;
  if (!item) return [];
  const nodes = [...item.inventoryLevels.edges.map((e) => e.node), ...extraLevels];
  const byLocation = new Map<string, InventoryLevelRow>();
  for (const node of nodes) {
    byLocation.set(node.location.id, {
      variant_external_id: variant.id,
      inventory_item_gid: item.id,
      location_gid: node.location.id,
      location_name: node.location.name,
      available: availableQuantity(node),
    });
  }
  return [...byLocation.values()];
}

/** Suma no destructiva del inventario de todas las ubicaciones de una variante. */
export function totalAvailable(rows: InventoryLevelRow[]): number {
  return rows.reduce((sum, row) => sum + row.available, 0);
}

/**
 * Recupera TODAS las variantes de un producto siguiendo la paginación.
 * Devuelve `complete: false` si no se pudo agotar la paginación.
 */
export async function fetchAllVariants(
  run: GraphqlRunner,
  product: ShopifyProductNode,
  maxPages = 50,
): Promise<{ variants: ShopifyVariantNode[]; complete: boolean }> {
  const variants = product.variants.edges.map((e) => e.node);
  let { hasNextPage, endCursor } = product.variants.pageInfo;
  let pages = 0;

  while (hasNextPage && endCursor) {
    if (pages >= maxPages) return { variants, complete: false };
    pages += 1;
    const data = await run<{
      product: {
        variants: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyVariantNode }>;
        };
      } | null;
    }>(PRODUCT_VARIANTS_PAGE_QUERY, { id: product.id, after: endCursor }, {
      requiredScopes: ['read_products'],
    });
    if (!data.product) return { variants, complete: false };
    variants.push(...data.product.variants.edges.map((e) => e.node));
    hasNextPage = data.product.variants.pageInfo.hasNextPage;
    endCursor = data.product.variants.pageInfo.endCursor;
  }

  return { variants, complete: true };
}

/** Recupera todos los niveles de inventario de una variante (paginación completa). */
export async function fetchAllInventoryLevels(
  run: GraphqlRunner,
  variant: ShopifyVariantNode,
  maxPages = 20,
): Promise<{ rows: InventoryLevelRow[]; complete: boolean }> {
  const item = variant.inventoryItem;
  if (!item) return { rows: [], complete: true };

  const extra: ShopifyInventoryLevelNode[] = [];
  let { hasNextPage, endCursor } = item.inventoryLevels.pageInfo;
  let pages = 0;

  while (hasNextPage && endCursor) {
    if (pages >= maxPages) {
      return { rows: inventoryRowsForVariant(variant, extra), complete: false };
    }
    pages += 1;
    const data = await run<{
      inventoryItem: {
        inventoryLevels: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyInventoryLevelNode }>;
        };
      } | null;
    }>(INVENTORY_LEVELS_PAGE_QUERY, { id: item.id, after: endCursor }, {
      requiredScopes: ['read_inventory'],
    });
    if (!data.inventoryItem) break;
    extra.push(...data.inventoryItem.inventoryLevels.edges.map((e) => e.node));
    hasNextPage = data.inventoryItem.inventoryLevels.pageInfo.hasNextPage;
    endCursor = data.inventoryItem.inventoryLevels.pageInfo.endCursor;
  }

  return { rows: inventoryRowsForVariant(variant, extra), complete: true };
}

// ---------------------------------------------------------------------------
// Clientes: el GID manda, el email es un dato mutable
// ---------------------------------------------------------------------------

export interface LocalClientRef {
  id: string;
  external_id: string | null;
  email: string | null;
}

/**
 * Decide con qué cliente local se corresponde un cliente de Shopify.
 * Nunca fusiona clientes distintos por compartir email: si el email ya está
 * ocupado por otro GID, se crea un cliente nuevo.
 */
export function resolveClientMatch(
  shopifyGid: string,
  email: string | null,
  candidates: LocalClientRef[],
): { action: 'update'; id: string } | { action: 'insert' } {
  const byGid = candidates.find((c) => c.external_id === shopifyGid);
  if (byGid) return { action: 'update', id: byGid.id };

  if (email) {
    const byEmail = candidates.find(
      (c) => !c.external_id && c.email && c.email.toLowerCase() === email.toLowerCase(),
    );
    if (byEmail) return { action: 'update', id: byEmail.id };
  }
  return { action: 'insert' };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const ORDER_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/paid',
  'fulfillments/create',
  'fulfillments/update',
  'refunds/create',
];

export const CATALOG_TOPICS_PREFIXES = ['products/', 'inventory_levels/', 'inventory_items/'];

export function isCatalogTopic(topic: string): boolean {
  return CATALOG_TOPICS_PREFIXES.some((p) => topic.startsWith(p));
}

/** Clave de deduplicación de un webhook (idempotencia). */
export function webhookDedupeKey(
  eventId: string | null,
  topic: string,
  payload: Record<string, unknown>,
): string {
  if (eventId) return eventId;
  const id = payload.admin_graphql_api_id ?? payload.id ?? 'unknown';
  const updated = payload.updated_at ?? payload.created_at ?? '';
  return `${topic}:${id}:${updated}`;
}

/** Extrae el GID del pedido de un payload de webhook. */
export function orderGidFromPayload(payload: Record<string, unknown>): string | null {
  const gid = payload.admin_graphql_api_id;
  if (typeof gid === 'string' && gid.includes('/Order/')) return gid;
  const orderId = payload.order_id;
  if (orderId !== undefined && orderId !== null) return `gid://shopify/Order/${orderId}`;
  const id = payload.id;
  if (id !== undefined && id !== null && typeof payload.admin_graphql_api_id !== 'string') {
    return `gid://shopify/Order/${id}`;
  }
  if (typeof gid === 'string' && gid.includes('/Fulfillment/') && orderId) {
    return `gid://shopify/Order/${orderId}`;
  }
  return null;
}

/** Backoff de reintentos de la cola de webhooks (segundos). */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(3600, 30 * Math.pow(3, Math.max(0, attempts - 1)));
}
