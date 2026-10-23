// Núcleo puro de la integración con Stockagile (sin dependencias de Deno: se prueba con Vitest).
//
// Stockagile es quien manda en el stock de Tuilus: lo que cambia allí lo envía a Shopify.
// Su API REST (https://api.stockagile.com/redoc/) acepta un token estático de usuario
// («Authorization: Token <clave>») que vive solo en el backend (STOCKAGILE_API_TOKEN).
// Piloto: solo para el negocio TUILUS, que es el dueño de ese token.

export const STOCKAGILE_API_BASE = 'https://api.stockagile.com/public/api/v2';

/** Negocio de PYMOVA dueño del token de Stockagile (piloto). */
export const STOCKAGILE_PILOT_BUSINESS_ID = 'c84f3b72-ae45-4501-a454-79cf47b888b4';

export class StockagileError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StockagileError';
    this.status = status;
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Token tal como lo espera la cabecera: sin espacios, comillas ni saltos de línea alrededor,
 * y sin el prefijo «Token» o «Bearer» si se pegó con él.
 */
export function normalizeStockagileToken(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/^(token|bearer)\s+/i, '')
    .trim();
}

/**
 * Motivo que da Stockagile en el cuerpo de un error (`message`, `detail` o `error`), o el de
 * un campo no válido (`{ "campo": ["motivo"] }`), recortado.
 */
async function errorReason(res: Response): Promise<string | null> {
  try {
    const body = await res.clone().json();
    const reason = body?.message ?? body?.detail ?? body?.error ?? body?.oauth_error_description;
    if (typeof reason === 'string' && reason.trim()) return reason.trim().slice(0, 200);
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const [field, value] = Object.entries(body)[0] ?? [];
      const text = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
      if (field && text.trim()) return `${field}: ${text.trim()}`.slice(0, 200);
    }
    return null;
  } catch {
    return null;
  }
}

interface Page<T> {
  count?: number;
  next: string | null;
  results: T[];
}

/** Lector de la API: cabecera del token, reintento ante 429 y paginación por `next`. */
export function createStockagileClient(
  fetcher: Fetcher,
  token: string,
  opts: { base?: string; sleep?: (ms: number) => Promise<void> } = {},
) {
  const base = opts.base ?? STOCKAGILE_API_BASE;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // Un 429 no aplica la petición, así que reintentarlo es seguro también en los POST.
  const request = async <T>(url: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetcher(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Token ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 429 && attempt < 3) {
        const wait = Math.min(Number(res.headers.get('Retry-After') ?? '1') || 1, 5);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) {
        const reason = await errorReason(res);
        const detail = `${res.status}${reason ? `: ${reason}` : ''}`;
        if (res.status === 401 || res.status === 403) {
          throw new StockagileError(`Stockagile no acepta el token (${detail}). Revisa STOCKAGILE_API_TOKEN`, res.status);
        }
        throw new StockagileError(`Stockagile respondió ${detail}`, res.status);
      }
      return (await res.json()) as T;
    }
  };

  const url = (path: string, params: Record<string, string | number | boolean | undefined> = {}) => {
    const u = new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  };

  return {
    /** Una página. */
    get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
      request<Page<T>>(url(path, params)),
    /** Escritura. */
    post: <T>(path: string, body: unknown) => request<T>(url(path), body),
    /** Todas las páginas (hasta `maxPages`), o hasta que `stop` diga que ya basta. */
    async getAll<T>(
      path: string,
      params: Record<string, string | number | boolean | undefined> = {},
      opts2: { maxPages?: number; stop?: (rows: T[]) => boolean } = {},
    ): Promise<T[]> {
      const rows: T[] = [];
      let next: string | null = url(path, params);
      for (let page = 0; next && page < (opts2.maxPages ?? 50); page++) {
        const data: Page<T> = await request<Page<T>>(next);
        rows.push(...(data.results ?? []));
        if (opts2.stop?.(rows)) break;
        next = data.next;
      }
      return rows;
    },
  };
}

export type StockagileClient = ReturnType<typeof createStockagileClient>;

// ---------------------------------------------------------------------------
// Emparejamiento de variantes y almacenes
// ---------------------------------------------------------------------------

export interface StockagileWarehouse {
  id: number;
  name: string;
  code?: string | null;
  is_principal?: boolean;
}

export interface StockagileVariant {
  id: number;
  product_id: number;
  sku?: string | null;
  barcode?: string | null;
  size_variant?: { name?: string | null; code?: string | null } | null;
  color_variant?: { name?: string | null; code?: string | null } | null;
  archived?: boolean;
}

export interface StockagileSiteProduct {
  id: number;
  product_id: number;
  external_id?: string | null;
}

const norm = (s: string | null | undefined) =>
  (s ?? '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/** Id numérico de un gid de Shopify («gid://shopify/Product/123» → «123»). */
export const shopifyNumericId = (gid: string | null | undefined) => (gid ?? '').split('/').pop() ?? '';

/** Almacén de Stockagile con el mismo nombre que la ubicación de Shopify (p. ej. «Tienda Valencia»). */
export function pickWarehouse(warehouses: StockagileWarehouse[], locationName: string | null | undefined) {
  const target = norm(locationName);
  if (!target) return null;
  return warehouses.find((w) => norm(w.name) === target) ?? null;
}

/** Producto de Stockagile vinculado al producto de Shopify. */
export function pickSiteProduct(siteProducts: StockagileSiteProduct[], shopifyProductGid: string | null | undefined) {
  const id = shopifyNumericId(shopifyProductGid);
  if (!id) return null;
  return siteProducts.find((sp) => shopifyNumericId(sp.external_id) === id) ?? null;
}

/**
 * Variante de Stockagile de una talla: por el nombre o código de la talla. Si el producto
 * solo tiene una variante activa, esa.
 */
export function pickVariantBySize(variants: StockagileVariant[], sizeLabels: (string | null | undefined)[]) {
  const active = variants.filter((v) => !v.archived);
  const wanted = sizeLabels.map(norm).filter(Boolean);
  const hits = active.filter(
    (v) => wanted.includes(norm(v.size_variant?.name)) || wanted.includes(norm(v.size_variant?.code)),
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0 && active.length === 1) return active[0];
  return null;
}

/** Tallas con las que se puede buscar la variante de PYMOVA: su nombre y los valores de sus atributos. */
export function sizeLabelsOf(variant: { name?: string | null; attributes?: Record<string, unknown> | null }) {
  const attrs = Object.values(variant.attributes ?? {}).map((v) => (v == null ? '' : String(v)));
  return [...new Set([variant.name ?? '', ...attrs].filter((s) => s.trim() !== ''))];
}

/** Variante de PYMOVA que hay que encontrar en Stockagile. */
export interface LocalVariant {
  barcode?: string | null;
  name?: string | null;
  attributes?: Record<string, unknown> | null;
  /** gid del producto de Shopify («gid://shopify/Product/…»). */
  shopifyProductGid?: string | null;
}

export interface VariantMatch {
  variant: StockagileVariant | null;
  matchedBy: 'barcode' | 'shopify-product' | null;
  note: string | null;
}

/**
 * Busca la variante en Stockagile: por código de barras (lo tienen casi todas, porque lo
 * pone Stockagile) y, si no, por el producto de Shopify y la talla. `loadSiteProducts` se
 * pasa para cargar los productos de la tienda una sola vez por ejecución.
 */
export async function findStockagileVariant(
  client: StockagileClient,
  local: LocalVariant,
  loadSiteProducts: () => Promise<StockagileSiteProduct[]>,
): Promise<VariantMatch> {
  let note: string | null = null;
  if (local.barcode) {
    const page = await client.get<StockagileVariant>('/product-variants', { barcode: local.barcode });
    const hits = page.results.filter((r) => !r.archived);
    if (hits.length === 1) return { variant: hits[0], matchedBy: 'barcode', note: null };
    if (hits.length > 1) note = `${hits.length} variantes con el mismo código de barras`;
  }
  const sp = pickSiteProduct(await loadSiteProducts(), local.shopifyProductGid);
  if (!sp) return { variant: null, matchedBy: null, note: note ?? 'El producto de Shopify no está en Stockagile' };
  const page = await client.get<StockagileVariant>('/product-variants', { product_id: sp.product_id, page_size: 100 });
  const variant = pickVariantBySize(page.results, sizeLabelsOf(local));
  return variant
    ? { variant, matchedBy: 'shopify-product', note: null }
    : { variant: null, matchedBy: null, note: note ?? 'Producto encontrado, pero no la talla' };
}

/**
 * Qué hacer con un movimiento cuyo envío ha fallado. Un 4xx (incluido un 429 tras los
 * reintentos) es un rechazo: no se ha aplicado y se puede reintentar. Cualquier otra cosa
 * (5xx, red, tiempo agotado) puede haberse aplicado: se deja para revisar a mano.
 */
export function failedMoveStatus(error: unknown): 'failed' | 'review' {
  return error instanceof StockagileError && error.status >= 400 && error.status < 500 ? 'failed' : 'review';
}
