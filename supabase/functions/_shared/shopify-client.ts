// Adaptador Deno del núcleo de Shopify: entorno, persistencia del token y HMAC.
// El token vive únicamente aquí (backend) y se cachea en `shopify_app_tokens`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createGraphqlRunner,
  createTokenManager,
  missingScopes,
  normalizeShopDomain,
  READ_SCOPES,
  SHOPIFY_API_VERSION,
  ShopifyError,
  verifyHmacSignature,
  type GraphqlOptions,
  type TokenRecord,
} from './shopify-core.ts';

export {
  missingScopes,
  normalizeShopDomain,
  READ_SCOPES,
  SHOPIFY_API_VERSION,
  ShopifyError,
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getShopDomain(): string {
  const raw = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  if (!raw) {
    throw new ShopifyError('Falta configurar el dominio de la tienda de Shopify.', 500);
  }
  return normalizeShopDomain(raw);
}

function credentials() {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new ShopifyError('Faltan las credenciales de la aplicación de Shopify.', 500);
  }
  return { clientId, clientSecret };
}

const tokens = (() => {
  let manager: ReturnType<typeof createTokenManager> | null = null;
  return () => {
    if (manager) return manager;
    const shop = getShopDomain();
    const { clientId, clientSecret } = credentials();
    const admin = serviceClient();

    manager = createTokenManager({
      shop,
      clientId,
      clientSecret,
      async load(): Promise<TokenRecord | null> {
        const { data } = await admin
          .from('shopify_app_tokens')
          .select('access_token, scopes, expires_at')
          .eq('shop_domain', shop)
          .maybeSingle();
        if (!data) return null;
        return {
          token: data.access_token,
          scopes: data.scopes ?? [],
          expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
        };
      },
      async persist(record: TokenRecord) {
        await admin.from('shopify_app_tokens').upsert(
          {
            shop_domain: shop,
            access_token: record.token,
            scopes: record.scopes,
            expires_at: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'shop_domain' },
        );
      },
    });
    return manager;
  };
})();

const runner = (() => {
  let instance: ReturnType<typeof createGraphqlRunner> | null = null;
  return () => {
    if (!instance) {
      instance = createGraphqlRunner({ shop: getShopDomain(), tokens: tokens() });
    }
    return instance;
  };
})();

export async function shopifyGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphqlOptions = {},
): Promise<T> {
  return await runner()<T>(query, variables, options);
}

export async function getGrantedScopes(): Promise<string[]> {
  const { scopes } = await tokens().get();
  return scopes;
}

export async function verifyConnection(): Promise<{ shop: string; name: string; scopes: string[] }> {
  const data = await shopifyGraphql<{ shop: { name: string; myshopifyDomain: string } }>(
    `query { shop { name myshopifyDomain } }`,
  );
  return {
    shop: data.shop.myshopifyDomain,
    name: data.shop.name,
    scopes: await getGrantedScopes(),
  };
}

export async function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? '';
  return await verifyHmacSignature(secret, rawBody, hmacHeader);
}
