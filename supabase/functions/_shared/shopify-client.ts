// Cliente centralizado de Shopify Admin API (solo backend).
// - Obtiene el access token con Client Credentials Grant (app PYMOVA).
// - Cachea el token en la tabla shopify_app_tokens (sin acceso desde el cliente).
// - Renueva automáticamente antes de caducar y reintenta una vez ante un 401.
// - Nunca devuelve ni registra el token.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SHOPIFY_API_VERSION = '2026-07';

/** Alcances de solo lectura concedidos a la app. */
export const READ_SCOPES = [
  'read_products',
  'read_inventory',
  'read_locations',
  'read_orders',
  'read_customers',
  'read_fulfillments',
] as const;

/** Margen de seguridad para renovar el token antes de que caduque. */
const RENEW_MARGIN_MS = 2 * 60 * 1000;

let serviceClient: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }
  return serviceClient;
}

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

export function getShopDomain(): string {
  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  if (!domain) {
    throw new ShopifyError('Falta configurar el dominio de la tienda de Shopify.', 503);
  }
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new ShopifyError(
      'La app de Shopify no está configurada (faltan las credenciales de la aplicación).',
      503,
    );
  }
  return { clientId, clientSecret };
}

interface CachedToken {
  token: string;
  scopes: string[];
  expiresAt: number | null;
}

let memoryToken: CachedToken | null = null;

/** Pide un token nuevo a Shopify mediante Client Credentials Grant. */
async function requestNewToken(shop: string): Promise<CachedToken> {
  const { clientId, clientSecret } = credentials();

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    // El cuerpo puede contener detalles de la app: no se registra tal cual.
    await response.text().catch(() => '');
    console.error(`Shopify token request failed with status ${response.status}`);
    throw new ShopifyError(
      response.status === 401 || response.status === 403
        ? 'Shopify ha rechazado las credenciales de la aplicación PYMOVA. Revisa que la app siga instalada en la tienda.'
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

  const scopes = (payload.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const expiresAt = payload.expires_in ? Date.now() + payload.expires_in * 1000 : null;

  await db()
    .from('shopify_app_tokens')
    .upsert(
      {
        shop_domain: shop,
        access_token: payload.access_token,
        scopes,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' },
    );

  return { token: payload.access_token, scopes, expiresAt };
}

function isUsable(cached: CachedToken | null): boolean {
  if (!cached?.token) return false;
  if (!cached.expiresAt) return true;
  return cached.expiresAt - RENEW_MARGIN_MS > Date.now();
}

/** Devuelve un token válido, reutilizando el cacheado mientras no caduque. */
async function getAccessToken(shop: string, forceRefresh = false): Promise<CachedToken> {
  if (!forceRefresh && isUsable(memoryToken)) return memoryToken!;

  if (!forceRefresh) {
    const { data } = await db()
      .from('shopify_app_tokens')
      .select('access_token, scopes, expires_at')
      .eq('shop_domain', shop)
      .maybeSingle();

    if (data?.access_token) {
      const cached: CachedToken = {
        token: data.access_token,
        scopes: data.scopes ?? [],
        expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
      };
      if (isUsable(cached)) {
        memoryToken = cached;
        return cached;
      }
    }
  }

  memoryToken = await requestNewToken(shop);
  return memoryToken;
}

/** Alcances concedidos actualmente a la app (según el último token emitido). */
export async function getGrantedScopes(): Promise<string[]> {
  const { scopes } = await getAccessToken(getShopDomain());
  return scopes;
}

export function missingScopes(granted: string[], required: readonly string[]): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GraphqlOptions {
  /** Alcances que necesita la consulta, para dar un error comprensible. */
  requiredScopes?: readonly string[];
  /** Reintentos ante límite de coste (throttling). */
  maxThrottleRetries?: number;
}

/**
 * Ejecuta una consulta GraphQL contra la Admin API.
 * Gestiona autenticación, 401 (reintento único con token nuevo) y throttling.
 */
export async function shopifyGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphqlOptions = {},
): Promise<T> {
  const shop = getShopDomain();
  const maxThrottleRetries = options.maxThrottleRetries ?? 3;
  let refreshed = false;
  let throttleAttempt = 0;

  for (;;) {
    const { token, scopes } = await getAccessToken(shop, refreshed);

    if (options.requiredScopes?.length) {
      const missing = missingScopes(scopes, options.requiredScopes);
      if (missing.length > 0 && scopes.length > 0) {
        throw new ShopifyError(
          `Esta consulta necesita permisos adicionales en Shopify: ${missing.join(', ')}. Añádelos en la configuración de la app PYMOVA y vuelve a instalarla.`,
          403,
          missing,
        );
      }
    }

    const response = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (response.status === 401) {
      await response.text().catch(() => '');
      if (!refreshed) {
        refreshed = true;
        memoryToken = null;
        continue;
      }
      throw new ShopifyError(
        'Shopify ha rechazado la autenticación de la app PYMOVA. Comprueba que sigue instalada en la tienda.',
        401,
      );
    }

    if (response.status === 403) {
      await response.text().catch(() => '');
      throw new ShopifyError(
        'Shopify ha denegado el acceso: la app no tiene los permisos de lectura necesarios.',
        403,
      );
    }

    if (response.status === 429) {
      await response.text().catch(() => '');
      if (throttleAttempt < maxThrottleRetries) {
        throttleAttempt += 1;
        await sleep(1000 * throttleAttempt);
        continue;
      }
      throw new ShopifyError('Shopify está limitando las peticiones. Inténtalo en unos minutos.', 429);
    }

    if (!response.ok) {
      console.error(`Shopify Admin API responded with status ${response.status}`);
      throw new ShopifyError(`Shopify ha devuelto un error (código ${response.status}).`, 502);
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string; requiredAccess?: string } }>;
    };

    if (payload.errors?.length) {
      const throttled = payload.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && throttleAttempt < maxThrottleRetries) {
        throttleAttempt += 1;
        await sleep(1000 * throttleAttempt);
        continue;
      }

      const accessDenied = payload.errors.find((e) => e.extensions?.requiredAccess);
      if (accessDenied) {
        const scope = accessDenied.extensions?.requiredAccess ?? '';
        throw new ShopifyError(
          `Shopify requiere el permiso «${scope}» para esta consulta. Añádelo a la app PYMOVA y reinstálala.`,
          403,
          scope ? [scope] : [],
        );
      }

      const messages = Array.from(
        new Set(payload.errors.map((e) => e.message.replace(/\s+/g, ' ').trim())),
      ).slice(0, 3);
      throw new ShopifyError(`Error de Shopify: ${messages.join('. ')}`, 502);
    }

    if (!payload.data) {
      throw new ShopifyError('Shopify no ha devuelto datos para esta consulta.', 502);
    }

    return payload.data;
  }
}

/** Verifica la conexión con una consulta real y mínima. */
export async function verifyConnection(): Promise<{ shop: string; name: string; scopes: string[] }> {
  const data = await shopifyGraphql<{ shop: { name: string; myshopifyDomain: string } }>(
    `query { shop { name myshopifyDomain } }`,
  );
  const scopes = await getGrantedScopes();
  return { shop: data.shop.myshopifyDomain, name: data.shop.name, scopes };
}

/** Verificación HMAC de webhooks usando el client secret de la app. */
export async function verifyWebhookHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  if (!hmacHeader) return false;
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(signature)));

  if (digest.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}
