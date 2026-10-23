import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCatalogCosts, PRODUCT_COLUMNS, VARIANT_COLUMNS } from '@/lib/catalogCosts';

type Result = { data: unknown[] | null; error: unknown };

/** Cliente falso: la RPC y las lecturas de tabla devuelven lo que se le pase. */
function fakeClient(rpc: Result, tables: Record<string, Result> = {}) {
  const calls: { table: string; select: string; filters: string[] }[] = [];
  const client = {
    rpc: vi.fn(() => ({ range: () => Promise.resolve(rpc) })),
    from: vi.fn((table: string) => {
      const call = { table, select: '', filters: [] as string[] };
      calls.push(call);
      const q = {
        select: (cols: string) => ((call.select = cols), q),
        eq: (col: string, val: string) => (call.filters.push(`${col}=${val}`), q),
        not: (col: string) => (call.filters.push(`${col} not null`), q),
        order: () => q,
        range: () => Promise.resolve(tables[table] ?? { data: [], error: null }),
      };
      return q;
    }),
  };
  return { client: client as unknown as SupabaseClient, calls, raw: client };
}

describe('fetchCatalogCosts', () => {
  it('usa la RPC y separa productos y tallas', async () => {
    const { client, raw } = fakeClient({
      data: [
        { kind: 'product', id: 'p1', cost_price: '12.5' },
        { kind: 'variant', id: 'v1', cost_price: 10 },
        { kind: 'variant', id: 'v2', cost_price: null },
      ],
      error: null,
    });
    const { costs, error } = await fetchCatalogCosts(client, 'b1', 'p1');
    expect(error).toBeNull();
    expect(raw.rpc).toHaveBeenCalledWith('get_catalog_costs', { _business_id: 'b1', _product_id: 'p1' });
    expect(raw.from).not.toHaveBeenCalled();
    expect([...costs.products]).toEqual([['p1', 12.5]]);
    expect([...costs.variants]).toEqual([['v1', 10]]);
  });

  it('sin la RPC todavía, lee el coste de las tablas', async () => {
    const { client, calls } = fakeClient(
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
      {
        products: { data: [{ id: 'p1', cost_price: 20 }], error: null },
        product_variants: { data: [{ id: 'v1', cost_price: 18 }], error: null },
      },
    );
    const { costs, error } = await fetchCatalogCosts(client, 'b1', 'p1');
    expect(error).toBeNull();
    expect(costs.products.get('p1')).toBe(20);
    expect(costs.variants.get('v1')).toBe(18);
    expect(calls.map((c) => [c.table, c.select, c.filters])).toEqual([
      ['products', 'id, cost_price', ['business_id=b1', 'cost_price not null', 'id=p1']],
      ['product_variants', 'id, cost_price', ['business_id=b1', 'cost_price not null', 'product_id=p1']],
    ]);
  });

  it('sin permiso, devuelve el error y ningún coste', async () => {
    const { client, raw } = fakeClient({ data: null, error: { code: '42501', message: 'Sin permiso' } });
    const { costs, error } = await fetchCatalogCosts(client, 'b1');
    expect(error).toMatchObject({ code: '42501' });
    expect(raw.from).not.toHaveBeenCalled();
    expect(costs.products.size + costs.variants.size).toBe(0);
  });
});

describe('columnas sin coste', () => {
  // Las columnas de types.ts (la foto de la base de datos) menos el coste: si se añade una
  // columna a la tabla y no a la lista, la app no la leería.
  const types = readFileSync(resolve(__dirname, '../integrations/supabase/types.ts'), 'utf8').replace(/\r\n/g, '\n');
  const rowColumns = (table: string) => {
    const block = types.split(new RegExp(`\\n      ${table}: \\{\\n        Row: \\{`))[1].split('\n        }')[0];
    return [...block.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
  };
  const list = (cols: string) => cols.split(',').map((c) => c.trim()).sort();

  it.each([
    ['products', PRODUCT_COLUMNS],
    ['product_variants', VARIANT_COLUMNS],
  ])('%s: todas menos cost_price', (table, cols) => {
    expect(list(cols)).not.toContain('cost_price');
    expect(list(cols)).toEqual(rowColumns(table).filter((c) => c !== 'cost_price'));
  });
});
