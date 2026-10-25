import { describe, expect, it } from 'vitest';
import {
  storeBusinessIds,
  storeConnection,
  type ConnectionClient,
} from '../../supabase/functions/_shared/shopify-connection';

/** Cliente falso: apunta la tabla, las columnas y cada filtro, y devuelve `result`. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; columns?: string; filters: [string, string, unknown][]; single: boolean } = {
    filters: [],
    single: false,
  };
  const query = {
    eq(column: string, value: unknown) {
      calls.filters.push(['eq', column, value]);
      return query;
    },
    is(column: string, value: null) {
      calls.filters.push(['is', column, value]);
      return query;
    },
    maybeSingle() {
      calls.single = true;
      return Promise.resolve(result);
    },
    then<A, B>(ok?: (v: typeof result) => A, ko?: (e: unknown) => B) {
      return Promise.resolve(result).then(ok, ko);
    },
  };
  const client: ConnectionClient = {
    from(table: string) {
      calls.table = table;
      return {
        select(columns: string) {
          calls.columns = columns;
          return query;
        },
      };
    },
  };
  return { client, calls };
}

const SHOP = 'tienda.myshopify.com';

describe('conexión con la tienda del despliegue (S1)', () => {
  it('busca la conexión del negocio solo en la tienda del despliegue y sin desinstalar', async () => {
    const { client, calls } = fakeClient({ data: { pos_orders_enabled: true }, error: null });
    const conn = await storeConnection<{ pos_orders_enabled: boolean }>(client, 'negocio-1', SHOP, 'pos_orders_enabled');
    expect(conn).toEqual({ pos_orders_enabled: true });
    expect(calls.table).toBe('shopify_connections');
    expect(calls.columns).toBe('pos_orders_enabled');
    expect(calls.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'shop_domain', SHOP],
        ['is', 'uninstalled_at', null],
        ['eq', 'business_id', 'negocio-1'],
      ]),
    );
    expect(calls.single).toBe(true);
  });

  it('sin conexión de esa tienda devuelve null', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await storeConnection(client, 'negocio-2', SHOP, 'business_id')).toBeNull();
  });

  it('no se traga los errores de la base de datos', async () => {
    const { client } = fakeClient({ data: null, error: new Error('caída') });
    await expect(storeConnection(client, 'negocio-1', SHOP, 'business_id')).rejects.toThrow('caída');
  });

  it('las tareas programadas solo recorren negocios de la tienda del despliegue', async () => {
    const { client, calls } = fakeClient({ data: [{ business_id: 'negocio-1' }], error: null });
    expect(await storeBusinessIds(client, SHOP, 'pos_orders_enabled')).toEqual(['negocio-1']);
    expect(calls.columns).toBe('business_id');
    expect(calls.filters).toEqual([
      ['eq', 'shop_domain', SHOP],
      ['is', 'uninstalled_at', null],
      ['eq', 'pos_orders_enabled', true],
    ]);
  });
});
