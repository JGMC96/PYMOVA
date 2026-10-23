import { describe, expect, it, vi } from 'vitest';
import {
  createStockagileClient,
  failedMoveStatus,
  findStockagileVariant,
  normalizeStockagileToken,
  pickSiteProduct,
  pickVariantBySize,
  pickWarehouse,
  shopifyNumericId,
  sizeLabelsOf,
  StockagileError,
  type StockagileVariant,
} from '../../supabase/functions/_shared/stockagile-core';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('cliente de la API de Stockagile', () => {
  it('manda el token con el prefijo «Token» y sigue las páginas', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(res(200, { next: 'https://api.stockagile.com/public/api/v2/warehouses?page=2', results: [{ id: 1 }] }))
      .mockResolvedValueOnce(res(200, { next: null, results: [{ id: 2 }] }));
    const client = createStockagileClient(fetcher, 'secreto');
    const rows = await client.getAll<{ id: number }>('/warehouses', { page_size: 100 });
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.stockagile.com/public/api/v2/warehouses?page_size=100');
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Token secreto' });
    expect(fetcher.mock.calls[1][0]).toContain('page=2');
  });

  it('para de paginar cuando ya tiene lo que busca', async () => {
    const fetcher = vi.fn().mockResolvedValue(res(200, { next: 'https://x/next', results: [{ id: 7 }] }));
    const client = createStockagileClient(fetcher, 't', { base: 'https://x' });
    await client.getAll<{ id: number }>('/stock', {}, { stop: (rows) => rows.some((r) => r.id === 7) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reintenta tras un 429 y avisa claro si el token no vale', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(res(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(res(200, { next: null, results: [] }))
      .mockResolvedValueOnce(res(403, { detail: 'no' }));
    const client = createStockagileClient(fetcher, 't', { sleep });
    await client.get('/warehouses');
    expect(sleep).toHaveBeenCalledWith(2000);
    await expect(client.get('/warehouses')).rejects.toBeInstanceOf(StockagileError);
    await expect(client.get('/warehouses')).rejects.toThrow();
  });
});

describe('token y errores de Stockagile', () => {
  it('limpia el token pegado con espacios, comillas, saltos de línea o el prefijo', () => {
    expect(normalizeStockagileToken('  abc123\n')).toBe('abc123');
    expect(normalizeStockagileToken('Token abc123')).toBe('abc123');
    expect(normalizeStockagileToken('"token  abc123"')).toBe('abc123');
    expect(normalizeStockagileToken('Bearer abc123')).toBe('abc123');
    expect(normalizeStockagileToken(undefined)).toBe('');
  });

  it('el aviso dice el código y el motivo que da Stockagile', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(res(403, { detail: 'Invalid token.' }))
      .mockResolvedValueOnce(res(401, { error: 'ERROR_1', message: 'Company is not active' }))
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(res(400, { created_at_after: ['Introduzca una fecha válida.'] }));
    const client = createStockagileClient(fetcher, 't');
    await expect(client.get('/warehouses')).rejects.toThrow('Stockagile no acepta el token (403: Invalid token.)');
    await expect(client.get('/warehouses')).rejects.toThrow('(401: Company is not active)');
    await expect(client.get('/warehouses')).rejects.toThrow('Stockagile respondió 502');
    await expect(client.get('/pos-orders')).rejects.toThrow('Stockagile respondió 400: created_at_after: Introduzca una fecha válida.');
  });
});

describe('emparejamiento con Stockagile', () => {
  it('elige el almacén con el nombre de la ubicación de Shopify, sin tildes ni mayúsculas', () => {
    const ws = [{ id: 1, name: 'Almacén Madrid' }, { id: 2, name: 'Tienda Valencia' }];
    expect(pickWarehouse(ws, 'tienda  valencia')?.id).toBe(2);
    expect(pickWarehouse(ws, 'Almacen Madrid')?.id).toBe(1);
    expect(pickWarehouse(ws, 'Barcelona')).toBeNull();
    expect(pickWarehouse(ws, null)).toBeNull();
  });

  it('encuentra el producto por el id de Shopify, venga como gid o como número', () => {
    const sps = [{ id: 1, product_id: 10, external_id: '11195103674711' }, { id: 2, product_id: 20, external_id: 'gid://shopify/Product/5' }];
    expect(shopifyNumericId('gid://shopify/Product/11195103674711')).toBe('11195103674711');
    expect(pickSiteProduct(sps, 'gid://shopify/Product/11195103674711')?.product_id).toBe(10);
    expect(pickSiteProduct(sps, 'gid://shopify/Product/5')?.product_id).toBe(20);
    expect(pickSiteProduct(sps, null)).toBeNull();
  });

  it('elige la variante por la talla y solo si no hay dudas', () => {
    const vs: StockagileVariant[] = [
      { id: 1, product_id: 10, size_variant: { name: '35-38' } },
      { id: 2, product_id: 10, size_variant: { name: '39-44' } },
      { id: 3, product_id: 10, size_variant: { name: '35-38' }, archived: true },
    ];
    expect(pickVariantBySize(vs, sizeLabelsOf({ name: '35-38', attributes: { Talla: '35-38' } }))?.id).toBe(1);
    expect(pickVariantBySize(vs, ['46'])).toBeNull();
    expect(pickVariantBySize([{ id: 9, product_id: 1 }], ['Única'])?.id).toBe(9);
    expect(pickVariantBySize([...vs, { id: 4, product_id: 10, size_variant: { name: '35-38' } }], ['35-38'])).toBeNull();
  });
});

describe('envío de movimientos a Stockagile', () => {
  it('manda el POST con el cuerpo en JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(res(200, { id: 1, stock: 85 }));
    const client = createStockagileClient(fetcher, 't');
    await client.post('/stock/move', { identifier_type: 'id', identifier: '7', quantity: 1, warehouse_id: 3278 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stockagile.com/public/api/v2/stock/move');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ identifier_type: 'id', identifier: '7', quantity: 1, warehouse_id: 3278 });
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Token t' });
  });

  it('un rechazo 4xx se puede reintentar; lo demás puede haberse aplicado y se revisa', () => {
    expect(failedMoveStatus(new StockagileError('x', 400))).toBe('failed');
    expect(failedMoveStatus(new StockagileError('x', 429))).toBe('failed');
    expect(failedMoveStatus(new StockagileError('x', 502))).toBe('review');
    expect(failedMoveStatus(new TypeError('fetch failed'))).toBe('review');
  });

  it('empareja por código de barras y, si no, por producto de Shopify y talla', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('barcode=2000')) return res(200, { next: null, results: [{ id: 11, product_id: 5 }] });
      if (url.includes('barcode=')) return res(200, { next: null, results: [] });
      if (url.includes('product_id=5')) {
        return res(200, { next: null, results: [
          { id: 21, product_id: 5, size_variant: { name: '35-38' } },
          { id: 22, product_id: 5, size_variant: { name: '39-44' } },
        ] });
      }
      return res(200, { next: null, results: [] });
    });
    const client = createStockagileClient(fetcher, 't');
    const sites = vi.fn().mockResolvedValue([{ id: 1, product_id: 5, external_id: '999' }]);

    const porCodigo = await findStockagileVariant(client, { barcode: '2000' }, sites);
    expect(porCodigo).toMatchObject({ matchedBy: 'barcode', variant: { id: 11 } });
    expect(sites).not.toHaveBeenCalled();

    const porTalla = await findStockagileVariant(
      client,
      { barcode: null, name: '39-44', shopifyProductGid: 'gid://shopify/Product/999' },
      sites,
    );
    expect(porTalla).toMatchObject({ matchedBy: 'shopify-product', variant: { id: 22 } });

    const sinProducto = await findStockagileVariant(client, { barcode: '1', shopifyProductGid: 'gid://shopify/Product/1' }, sites);
    expect(sinProducto).toEqual({ variant: null, matchedBy: null, note: 'El producto de Shopify no está en Stockagile' });
  });
});
