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
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
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
  const set = new Set(granted);
  // En Shopify, write_X implica read_X: el alcance de escritura concede la lectura.
  for (const scope of granted) {
    if (scope.startsWith('write_')) set.add(`read_${scope.slice('write_'.length)}`);
  }
  return required.filter((scope) => !set.has(scope));
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
        // Consulta demasiado costosa: reintentar pidiendo menos elementos por página.
        const tooCostly = payload.errors.some((e) =>
          /max cost limit/i.test(e.message ?? ''),
        );
        const currentFirst = Number(variables.first);
        if (tooCostly && Number.isFinite(currentFirst) && currentFirst > 1) {
          variables = { ...variables, first: Math.max(1, Math.floor(currentFirst / 2)) };
          continue;
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
    unitCost { amount }
    inventoryLevels(first: 5) {
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
          colorField: metafield(namespace: "custom", key: "color") { value }
          variants(first: 25) {
            pageInfo { hasNextPage endCursor }
            edges { node { ${VARIANT_FIELDS} } }
          }
        }
      }
    }
  }
`;

/** Un producto por su GID, con los mismos campos que un nodo de PRODUCTS_QUERY. */
export const PRODUCT_BY_ID_QUERY = `
  query ProductById($id: ID!) {
    product(id: $id) {
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
      colorField: metafield(namespace: "custom", key: "color") { value }
      variants(first: 25) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${VARIANT_FIELDS} } }
      }
    }
  }
`;

/** Página adicional de variantes de un producto concreto. */
export const PRODUCT_VARIANTS_PAGE_QUERY = `
  query ProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      id
      variants(first: 25, after: $after) {
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
    unitCost?: { amount: string | null } | null;
    inventoryLevels: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: ShopifyInventoryLevelNode }>;
    };
  } | null;
}

/** Coste unitario informado en Shopify (inventoryItem.unitCost), o null si no está. */
export function variantUnitCost(variant: ShopifyVariantNode): number | null {
  const raw = variant.inventoryItem?.unitCost?.amount;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
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
  /** Metacampo custom.color (p. ej. «Piel Negro»), si la consulta lo pide. */
  colorField?: { value: string | null } | null;
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
 * Disponible en la ubicación de la tienda (la que usa Pymova como stock). Sin ubicación
 * por defecto, la suma de todas. Null si Shopify no da niveles para la variante.
 */
export function availableAtLocation(
  rows: InventoryLevelRow[],
  locationGid: string | null | undefined,
): number | null {
  if (rows.length === 0) return null;
  if (!locationGid) return totalAvailable(rows);
  return rows.filter((row) => row.location_gid === locationGid).reduce((sum, row) => sum + row.available, 0);
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

// ---------------------------------------------------------------------------
// Reembolsos de devoluciones del TPV
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Importe a reembolsar en Shopify por una devolución: la suma de sus líneas,
 * nunca por encima de lo que queda por reembolsar de la venta.
 */
export function refundAmountForReturn(
  items: { quantity: number; unit_price: number; total?: number | null }[],
  saleTotal: number,
  alreadyRefunded: number,
): number {
  // `total` es lo cobrado en la línea devuelta (con su descuento, dz/0021); las líneas
  // antiguas sin total usan unidades × precio.
  const lines = round2(
    items.reduce(
      (sum, i) => sum + (i.total != null ? Number(i.total) : Number(i.quantity) * Number(i.unit_price)),
      0,
    ),
  );
  const pending = Math.max(0, round2(Number(saleTotal) - Number(alreadyRefunded)));
  return Math.max(0, Math.min(lines, pending));
}

/**
 * Línea del pedido de Shopify que corresponde a un artículo devuelto y aún tiene
 * unidades por reembolsar. Primero por variante; si no, por nombre: los pedidos creados
 * antes de que el artículo estuviera emparejado llevan una línea suelta sin variante.
 */
export function findRefundLine<L extends { id: string; title: string; variant: { id: string } | null }>(
  lines: L[],
  remaining: Map<string, number>,
  item: { variantGid: string | null | undefined; productName: string },
): L | undefined {
  const open = lines.filter((n) => (remaining.get(n.id) ?? 0) > 0);
  return (
    (item.variantGid ? open.find((n) => n.variant?.id === item.variantGid) : undefined) ??
    open.find((n) => !n.variant && n.title === item.productName) ??
    (item.variantGid ? undefined : open.find((n) => n.title === item.productName))
  );
}

// ---------------------------------------------------------------------------
// Inventario desde Shopify (webhooks inventory_levels/update y refresco de stock)
// ---------------------------------------------------------------------------

/** Nivel de inventario listo para `apply_shopify_inventory_levels`. */
export interface ShopifyLevelUpdate {
  inventory_item_gid: string;
  location_gid: string;
  available: number;
  updated_at: string | null;
  location_name?: string | null;
}

/** Id numérico o GID de Shopify → GID del tipo indicado (null si no es válido). */
export function toShopifyGid(kind: 'InventoryItem' | 'Location', id: unknown): string | null {
  if (typeof id === 'string' && id.startsWith(`gid://shopify/${kind}/`)) return id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return `gid://shopify/${kind}/${id}`;
  if (typeof id === 'string' && /^\d+$/.test(id)) return `gid://shopify/${kind}/${id}`;
  return null;
}

/** Payload REST del webhook inventory_levels/update → nivel a aplicar. */
export function levelFromInventoryWebhook(payload: Record<string, unknown>): ShopifyLevelUpdate | null {
  const item = toShopifyGid('InventoryItem', payload.inventory_item_id);
  const location = toShopifyGid('Location', payload.location_id);
  const available = typeof payload.available === 'number' && Number.isFinite(payload.available)
    ? Math.trunc(payload.available)
    : null;
  if (!item || !location || available === null) return null;
  return {
    inventory_item_gid: item,
    location_gid: location,
    available,
    updated_at: typeof payload.updated_at === 'string' ? payload.updated_at : null,
  };
}

/** Disponible de varios inventory items en todas sus ubicaciones (lotes de 40). */
export const INVENTORY_ITEMS_LEVELS_QUERY = `
  query InventoryItemsLevels($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevels(first: 10) {
          edges {
            node {
              updatedAt
              location { id name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
`;

export const INVENTORY_ITEMS_BATCH = 40;

export interface InventoryItemLevelsNode {
  id: string;
  inventoryLevels?: {
    edges: Array<{
      node: {
        updatedAt?: string | null;
        location: { id: string; name?: string | null };
        quantities: Array<{ name: string; quantity: number }>;
      };
    }>;
  };
}

/** Respuesta de INVENTORY_ITEMS_LEVELS_QUERY → niveles a aplicar. */
export function levelsFromInventoryItemNodes(
  nodes: Array<InventoryItemLevelsNode | null | Record<string, never>>,
): ShopifyLevelUpdate[] {
  const out: ShopifyLevelUpdate[] = [];
  for (const node of nodes) {
    if (!node || typeof (node as InventoryItemLevelsNode).id !== 'string') continue;
    const item = node as InventoryItemLevelsNode;
    for (const { node: level } of item.inventoryLevels?.edges ?? []) {
      const available = level.quantities.find((q) => q.name === 'available')?.quantity;
      if (typeof available !== 'number') continue;
      out.push({
        inventory_item_gid: item.id,
        location_gid: level.location.id,
        location_name: level.location.name ?? null,
        available,
        updated_at: level.updatedAt ?? null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catálogo desde Shopify (webhooks products/create, products/update, products/delete)
// ---------------------------------------------------------------------------

/** Payload REST de un webhook de producto → GID del producto (null si no es válido). */
export function productGidFromPayload(payload: Record<string, unknown>): string | null {
  const gid = payload.admin_graphql_api_id;
  if (typeof gid === 'string' && gid.startsWith('gid://shopify/Product/')) return gid;
  const id = payload.id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return `gid://shopify/Product/${id}`;
  if (typeof id === 'string' && /^\d+$/.test(id)) return `gid://shopify/Product/${id}`;
  return null;
}

export type CatalogAction = 'import' | 'update' | 'deactivate' | 'skip';

/**
 * Qué hacer con un producto de Shopify según su estado (null = ya no existe en
 * Shopify) y si ya está en Pymova. Solo entran los activos; un borrador o archivado
 * que ya estaba se desactiva, y uno que no estaba se ignora hasta que se active.
 */
export function catalogAction(status: string | null, existsLocally: boolean): CatalogAction {
  if (status === 'ACTIVE') return existsLocally ? 'update' : 'import';
  return existsLocally ? 'deactivate' : 'skip';
}

/** Variantes locales (por su id de Shopify) que ya no existen en el producto de Shopify. */
export function variantsToDeactivate(localExternalIds: string[], shopifyIds: string[]): string[] {
  const current = new Set(shopifyIds);
  return localExternalIds.filter((id) => !current.has(id));
}

/** Emparejamiento local de un artículo de inventario. */
export interface LevelPairing {
  local_product_id: string | null;
  local_variant_id: string | null;
}

/**
 * Filas de inventario cuyo artículo es nuevo para Pymova o ha cambiado de
 * emparejamiento: son las únicas a las que un aviso de producto pone stock. El stock
 * de los artículos ya conocidos lo traen inventory_levels/update y el refresco nocturno.
 */
export function levelRowsNeedingStock<T extends { inventory_item_gid: string }>(
  rows: T[],
  known: Map<string, LevelPairing>,
  expected: (row: T) => LevelPairing,
): T[] {
  return rows.filter((row) => {
    const before = known.get(row.inventory_item_gid);
    if (!before) return true;
    const now = expected(row);
    return before.local_product_id !== now.local_product_id || before.local_variant_id !== now.local_variant_id;
  });
}

/**
 * Productos locales que ya no deben venderse: los que Shopify no devuelve (borrados) o
 * devuelve sin estar activos. `nodes` es la respuesta de `nodes(ids:)` en el mismo orden.
 */
export function productsGoneFromShopify(
  externalIds: string[],
  nodes: Array<{ id?: string; status?: string } | null>,
): string[] {
  return externalIds.filter((id, i) => {
    const node = nodes[i];
    return !node || node.id !== id || node.status !== 'ACTIVE';
  });
}

/** Estado de varios productos por GID (lotes de hasta 50). */
export const PRODUCTS_STATUS_QUERY = `
  query ProductsStatus($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id status }
    }
  }
`;

// ---------------------------------------------------------------------------
// Ventas del TPV en Shopify: número de ticket y vendedor
// ---------------------------------------------------------------------------

/** Texto apto para etiqueta de Shopify: sin comas, espacios simples, como mucho 40 caracteres. */
export function shopifyTag(text: string | null | undefined): string | null {
  const clean = String(text ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return clean || null;
}

/**
 * Etiquetas que identifican una venta del TPV en Shopify. El buscador de pedidos de
 * Shopify busca en las etiquetas (no en la nota), así que con el número de ticket como
 * etiqueta, el código de barras del ticket encuentra el pedido.
 */
export function posTicketTags(ticketNumber: string, sellerName: string | null | undefined): string[] {
  const seller = shopifyTag(sellerName ? `Vendedor: ${sellerName}` : null);
  return [shopifyTag(ticketNumber), seller].filter((t): t is string => !!t);
}

/** «Detalles adicionales» del pedido en Shopify: ticket y vendedor. */
export function posOrderAttributes(
  ticketNumber: string,
  sellerName: string | null | undefined,
): Array<{ key: string; value: string }> {
  const attrs = [{ key: 'Ticket', value: ticketNumber }];
  const seller = String(sellerName ?? '').trim();
  if (seller) attrs.push({ key: 'Vendedor', value: seller });
  return attrs;
}

/** Búsqueda de Shopify del pedido creado para una venta del TPV (sourceIdentifier = id de la venta). */
export function posOrderSearchQuery(saleId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) throw new Error('Identificador de venta no válido');
  return `source_identifier:${saleId}`;
}

/** Pasarela con la que se apunta en Shopify lo pagado con vale de tienda. */
export const VOUCHER_GATEWAY = 'Vale de tienda';

/**
 * Cobros del pedido de una venta de tienda: lo pagado con vale (si hay) y el resto con el
 * método de la venta. Sin importes a 0. El vale nunca pasa del total (lo exige la venta).
 */
export function posSaleTransactions(
  total: number,
  voucherAmount: number,
  gateway: string,
): { gateway: string; amount: number }[] {
  const t = Math.round(Number(total) * 100) / 100;
  const v = Math.min(Math.max(Math.round(Number(voucherAmount || 0) * 100) / 100, 0), t);
  const rest = Math.round((t - v) * 100) / 100;
  return [
    ...(v > 0 ? [{ gateway: VOUCHER_GATEWAY, amount: v }] : []),
    ...(rest > 0 || v === 0 ? [{ gateway, amount: rest }] : []),
  ];
}

export interface ShopifyOrderTransaction {
  id: string;
  kind: string;
  status: string;
  gateway: string;
  amountSet?: { shopMoney: { amount: string } } | null;
  parentTransaction?: { id: string } | null;
}

/**
 * Reparte un reembolso entre los cobros del pedido, sin pasar de lo que le queda a cada uno
 * (lo cobrado menos sus reembolsos). Primero el dinero (tarjeta, efectivo…) y al final el vale.
 * Si no llega, se reparte lo que se puede.
 */
export function planRefundTransactions(
  transactions: ShopifyOrderTransaction[],
  amount: number,
): { parentId: string; gateway: string; amount: number }[] {
  const cents = (s: string | number | undefined | null) => Math.round(Number(s ?? 0) * 100);
  const ok = transactions.filter((t) => t.status === 'SUCCESS');
  const refunded = new Map<string, number>();
  for (const t of ok) {
    if (t.kind === 'REFUND' && t.parentTransaction?.id) {
      refunded.set(t.parentTransaction.id, (refunded.get(t.parentTransaction.id) ?? 0) + cents(t.amountSet?.shopMoney.amount));
    }
  }
  const parents = ok
    .filter((t) => t.kind === 'SALE' || t.kind === 'CAPTURE')
    .sort((a, b) => Number(a.gateway === VOUCHER_GATEWAY) - Number(b.gateway === VOUCHER_GATEWAY));
  let left = cents(amount);
  const plan: { parentId: string; gateway: string; amount: number }[] = [];
  for (const p of parents) {
    if (left <= 0) break;
    const available = cents(p.amountSet?.shopMoney.amount) - (refunded.get(p.id) ?? 0);
    const take = Math.min(available, left);
    if (take > 0) {
      plan.push({ parentId: p.id, gateway: p.gateway, amount: take / 100 });
      left -= take;
    }
  }
  return plan;
}

/** Nivel de inventario (artículo de Shopify en una ubicación) para un envío de stock. */
export interface PushLevel {
  inventory_item_gid: string;
  location_gid: string;
  available: number;
  local_variant_id: string | null;
  local_product_id: string | null;
}

/**
 * Elige la ubicación de Shopify a la que va un envío de stock. Si el envío lleva ubicación
 * (p. ej. una compra para el almacén), solo vale esa: sin nivel allí no se envía a otra.
 * Si no, la de la tienda; y si el artículo no está en ella, la que más stock tenga.
 */
export function pickPushLevel<L extends PushLevel>(
  levels: L[],
  row: { local_variant_id: string | null; local_product_id: string | null; location_gid?: string | null },
  preferred: string | null,
): L | null {
  const matches = levels.filter((l) =>
    row.local_variant_id
      ? l.local_variant_id === row.local_variant_id
      : !!row.local_product_id && l.local_product_id === row.local_product_id,
  );
  if (matches.length === 0) return null;
  if (row.location_gid) return matches.find((l) => l.location_gid === row.location_gid) ?? null;
  if (preferred) {
    const atPreferred = matches.find((l) => l.location_gid === preferred);
    if (atPreferred) return atPreferred;
  }
  return [...matches].sort((a, b) => b.available - a.available)[0];
}

/**
 * Color del producto para Pymova (metacampo custom.color de Shopify). `undefined` si la
 * consulta no lo trajo (no se toca lo guardado); null si el producto no lo tiene.
 */
export function productColor(node: Pick<ShopifyProductNode, 'colorField'>): string | null | undefined {
  if (!('colorField' in node)) return undefined;
  const value = node.colorField?.value?.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 120) : null;
}
