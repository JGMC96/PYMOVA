import { describe, expect, it, vi } from 'vitest';
import {
  createGraphqlRunner,
  createTokenManager,
  fetchAllInventoryLevels,
  fetchAllVariants,
  inventoryRowsForVariant,
  isTokenUsable,
  normalizeShopDomain,
  resolveClientMatch,
  retryDelaySeconds,
  ShopifyError,
  totalAvailable,
  verifyHmacSignature,
  webhookDedupeKey,
  orderGidFromPayload,
  type ShopifyProductNode,
  type ShopifyVariantNode,
} from '../../supabase/functions/_shared/shopify-core';

const gqlResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const tokenResponse = (token: string, expiresIn?: number, scope = 'read_products,read_inventory') =>
  new Response(
    JSON.stringify({ access_token: token, scope, ...(expiresIn ? { expires_in: expiresIn } : {}) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const makeVariant = (
  id: string,
  levels: Array<{ loc: string; name: string; qty: number }>,
  hasNextPage = false,
  endCursor: string | null = null,
): ShopifyVariantNode => ({
  id,
  title: id,
  sku: `${id}-sku`,
  barcode: null,
  price: '10.00',
  availableForSale: true,
  selectedOptions: [],
  inventoryItem: {
    id: `${id}-item`,
    tracked: true,
    inventoryLevels: {
      pageInfo: { hasNextPage, endCursor },
      edges: levels.map((l) => ({
        node: {
          location: { id: l.loc, name: l.name, isActive: true },
          quantities: [{ name: 'available', quantity: l.qty }],
        },
      })),
    },
  },
});

describe('normalizeShopDomain', () => {
  it('quita protocolo, barras y mayúsculas', () => {
    expect(normalizeShopDomain(' HTTPS://Mi-Tienda.myshopify.com/ ')).toBe(
      'mi-tienda.myshopify.com',
    );
  });
});

describe('HMAC de webhooks', () => {
  it('acepta la firma correcta y rechaza la manipulada', async () => {
    const secret = 'shpss_secreto';
    const body = JSON.stringify({ id: 1, topic: 'orders/create' });
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const raw = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    );
    const signature = btoa(String.fromCharCode(...raw));

    await expect(verifyHmacSignature(secret, body, signature)).resolves.toBe(true);
    await expect(verifyHmacSignature(secret, `${body} `, signature)).resolves.toBe(false);
    await expect(verifyHmacSignature('otro', body, signature)).resolves.toBe(false);
    await expect(verifyHmacSignature(secret, body, null)).resolves.toBe(false);
    await expect(verifyHmacSignature(secret, body, 'no-base64!!')).resolves.toBe(false);
  });
});

describe('gestión del token', () => {
  it('considera caducado un token dentro del margen de renovación', () => {
    const now = 1_000_000;
    expect(isTokenUsable({ token: 't', scopes: [], expiresAt: now + 60_000 }, now)).toBe(false);
    expect(isTokenUsable({ token: 't', scopes: [], expiresAt: now + 600_000 }, now)).toBe(true);
    expect(isTokenUsable({ token: 't', scopes: [], expiresAt: null }, now)).toBe(true);
    expect(isTokenUsable(null, now)).toBe(false);
  });

  it('reutiliza el token en memoria y sólo pide uno nuevo al caducar', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => tokenResponse('tok-1', 600));
    const manager = createTokenManager({
      shop: 'demo.myshopify.com',
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect((await manager.get()).token).toBe('tok-1');
    expect((await manager.get()).token).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = 599_000; // dentro del margen de 2 minutos
    fetchImpl.mockResolvedValueOnce(tokenResponse('tok-2', 600));
    expect((await manager.get()).token).toBe('tok-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('persiste el token emitido y lo recupera de la base de datos', async () => {
    const persisted: unknown[] = [];
    const fetchImpl = vi.fn(async () => tokenResponse('tok-db', 3600));
    const manager = createTokenManager({
      shop: 'demo.myshopify.com',
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      load: async () => ({ token: 'tok-stored', scopes: ['read_products'], expiresAt: null }),
      persist: async (record) => {
        persisted.push(record);
      },
    });

    expect((await manager.get()).token).toBe('tok-stored');
    expect(fetchImpl).not.toHaveBeenCalled();

    manager.invalidate();
    expect((await manager.get(true)).token).toBe('tok-db');
    expect(persisted).toHaveLength(1);
  });

  it('traduce credenciales inválidas en un error claro', async () => {
    const manager = createTokenManager({
      shop: 'demo.myshopify.com',
      clientId: 'id',
      clientSecret: 'malo',
      fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(manager.get()).rejects.toThrow(/credenciales/i);
  });
});

describe('ejecución GraphQL', () => {
  const tokens = (values: string[]) => {
    let index = 0;
    return {
      get: vi.fn(async (force = false) => {
        if (force) index = Math.min(index + 1, values.length - 1);
        return { token: values[index], scopes: ['read_products', 'read_inventory'], expiresAt: null };
      }),
      invalidate: vi.fn(),
    };
  };

  it('renueva el token y reintenta una única vez ante un 401', async () => {
    const store = tokens(['viejo', 'nuevo']);
    const used: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>)['X-Shopify-Access-Token'];
      used.push(token);
      if (token === 'viejo') return new Response('unauthorized', { status: 401 });
      return gqlResponse({ data: { shop: { name: 'Demo' } } });
    });

    const run = createGraphqlRunner({
      shop: 'demo.myshopify.com',
      tokens: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(run('query { shop { name } }')).resolves.toEqual({ shop: { name: 'Demo' } });
    expect(used).toEqual(['viejo', 'nuevo']);
    expect(store.invalidate).toHaveBeenCalledTimes(1);
  });

  it('falla con 401 si el token renovado también es rechazado', async () => {
    const store = tokens(['a', 'b']);
    const run = createGraphqlRunner({
      shop: 'demo.myshopify.com',
      tokens: store,
      fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(run('query { shop { name } }')).rejects.toMatchObject({ status: 401 });
  });

  it('detecta permisos que faltan antes de llamar a Shopify', async () => {
    const store = {
      get: async () => ({ token: 't', scopes: ['read_products'], expiresAt: null }),
      invalidate: () => {},
    };
    const fetchImpl = vi.fn();
    const run = createGraphqlRunner({
      shop: 'demo.myshopify.com',
      tokens: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      run('query { x }', {}, { requiredScopes: ['read_products', 'read_orders'] }),
    ).rejects.toMatchObject({ status: 403, missingScopes: ['read_orders'] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reintenta con espera cuando Shopify limita las peticiones', async () => {
    const store = tokens(['t']);
    let calls = 0;
    const sleep = vi.fn(async () => {});
    const run = createGraphqlRunner({
      shop: 'demo.myshopify.com',
      tokens: store,
      sleep,
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) {
          return gqlResponse({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] });
        }
        return gqlResponse({ data: { ok: true } });
      }) as unknown as typeof fetch,
    });

    await expect(run('query { ok }')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('propaga los errores de GraphQL como ShopifyError', async () => {
    const store = tokens(['t']);
    const run = createGraphqlRunner({
      shop: 'demo.myshopify.com',
      tokens: store,
      fetchImpl: (async () =>
        gqlResponse({ errors: [{ message: 'Field is not defined' }] })) as unknown as typeof fetch,
    });
    await expect(run('query { nope }')).rejects.toBeInstanceOf(ShopifyError);
  });
});

describe('inventario por ubicación', () => {
  it('genera una fila por ubicación y no colapsa el stock', () => {
    const variant = makeVariant('gid://shopify/ProductVariant/1', [
      { loc: 'gid://shopify/Location/1', name: 'Tienda', qty: 3 },
      { loc: 'gid://shopify/Location/2', name: 'Almacén', qty: 7 },
    ]);
    const rows = inventoryRowsForVariant(variant);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.location_name).sort()).toEqual(['Almacén', 'Tienda']);
    expect(rows.every((r) => r.inventory_item_gid === 'gid://shopify/ProductVariant/1-item')).toBe(true);
    expect(totalAvailable(rows)).toBe(10);
  });

  it('sigue la paginación de niveles de inventario', async () => {
    const variant = makeVariant(
      'v1',
      [{ loc: 'L1', name: 'Tienda', qty: 2 }],
      true,
      'cursor-1',
    );
    const run = vi.fn(async () => ({
      inventoryItem: {
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                location: { id: 'L2', name: 'Almacén', isActive: true },
                quantities: [{ name: 'available', quantity: 5 }],
              },
            },
          ],
        },
      },
    }));

    const { rows, complete } = await fetchAllInventoryLevels(run as never, variant);
    expect(complete).toBe(true);
    expect(rows).toHaveLength(2);
    expect(totalAvailable(rows)).toBe(7);
  });
});

describe('paginación de variantes', () => {
  it('recupera todas las variantes de un producto con más de 100', async () => {
    const product: ShopifyProductNode = {
      id: 'gid://shopify/Product/1',
      title: 'Zapato',
      handle: 'zapato',
      description: '',
      productType: null,
      vendor: null,
      status: 'ACTIVE',
      featuredImage: null,
      priceRangeV2: { minVariantPrice: { amount: '10.00', currencyCode: 'EUR' } },
      variants: {
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
        edges: Array.from({ length: 100 }, (_, i) => ({
          node: makeVariant(`v${i}`, [{ loc: 'L1', name: 'Tienda', qty: 1 }]),
        })),
      },
    };

    const run = vi.fn(async () => ({
      product: {
        variants: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [{ node: makeVariant('v100', [{ loc: 'L1', name: 'Tienda', qty: 1 }]) }],
        },
      },
    }));

    const { variants, complete } = await fetchAllVariants(run as never, product);
    expect(complete).toBe(true);
    expect(variants).toHaveLength(101);
    expect(variants.at(-1)?.id).toBe('v100');
  });

  it('marca la paginación como incompleta al superar el límite de páginas', async () => {
    const product: ShopifyProductNode = {
      id: 'p1',
      title: 'Infinito',
      handle: 'inf',
      description: '',
      productType: null,
      vendor: null,
      status: 'ACTIVE',
      featuredImage: null,
      priceRangeV2: { minVariantPrice: { amount: '1', currencyCode: 'EUR' } },
      variants: { pageInfo: { hasNextPage: true, endCursor: 'c' }, edges: [] },
    };
    const run = vi.fn(async () => ({
      product: {
        variants: { pageInfo: { hasNextPage: true, endCursor: 'c' }, edges: [] },
      },
    }));
    const { complete } = await fetchAllVariants(run as never, product, 2);
    expect(complete).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('clientes', () => {
  const gid = 'gid://shopify/Customer/1';

  it('actualiza el cliente que ya tiene el mismo identificador de Shopify', () => {
    expect(
      resolveClientMatch(gid, 'ana@example.com', [
        { id: 'local-1', external_id: gid, email: 'otra@example.com' },
      ]),
    ).toEqual({ action: 'update', id: 'local-1' });
  });

  it('nunca fusiona dos clientes de Shopify que comparten email', () => {
    expect(
      resolveClientMatch(gid, 'ana@example.com', [
        { id: 'local-1', external_id: 'gid://shopify/Customer/999', email: 'ana@example.com' },
      ]),
    ).toEqual({ action: 'insert' });
  });

  it('adopta un cliente local sin identificador externo cuando coincide el email', () => {
    expect(
      resolveClientMatch(gid, 'Ana@Example.com', [
        { id: 'local-2', external_id: null, email: 'ana@example.com' },
      ]),
    ).toEqual({ action: 'update', id: 'local-2' });
  });
});

describe('cola de webhooks', () => {
  it('deduplica por identificador de webhook y, si falta, por contenido', () => {
    expect(webhookDedupeKey('wh-1', 'orders/create', { id: 5 })).toBe('wh-1');
    expect(webhookDedupeKey(null, 'orders/updated', { id: 5, updated_at: '2026-01-01' })).toBe(
      'orders/updated:5:2026-01-01',
    );
  });

  it('extrae el pedido de distintos formatos de payload', () => {
    expect(orderGidFromPayload({ admin_graphql_api_id: 'gid://shopify/Order/9' })).toBe(
      'gid://shopify/Order/9',
    );
    expect(orderGidFromPayload({ order_id: 7 })).toBe('gid://shopify/Order/7');
    expect(orderGidFromPayload({ id: 3 })).toBe('gid://shopify/Order/3');
    expect(orderGidFromPayload({})).toBeNull();
  });

  it('aplica un backoff creciente y acotado', () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(90);
    expect(retryDelaySeconds(3)).toBe(270);
    expect(retryDelaySeconds(10)).toBe(3600);
  });
});
