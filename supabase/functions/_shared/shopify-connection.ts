// Conexión con la tienda de Shopify de este despliegue (S1, auditoría de seguridad del 23/10/2026).
// Las credenciales de la tienda son globales (SHOPIFY_STORE_DOMAIN): antes de escribir en Shopify en
// nombre de un negocio hay que comprobar que su conexión es la de ESA tienda y que sigue instalada.
// Buscarla solo por business_id dejaba a cualquier negocio con una fila en shopify_connections (con
// un dominio cualquiera) mandar pedidos, reembolsos o stock a la tienda de otro.
// Sin imports de Deno ni npm: se prueba con Vitest (src/test/shopify-connection.test.ts).

type Result = { data: unknown; error: unknown };

/** Lo mínimo del constructor de consultas de supabase-js que se usa aquí. */
export interface ConnectionQuery extends PromiseLike<Result> {
  eq(column: string, value: unknown): ConnectionQuery;
  is(column: string, value: null): ConnectionQuery;
  maybeSingle(): PromiseLike<Result>;
}

/** Cualquier cliente de Supabase (el del service role en las funciones). */
export interface ConnectionClient {
  from(table: string): unknown;
}

/** Conexiones activas de la tienda del despliegue (para las tareas programadas). */
export function storeConnectionsQuery(admin: ConnectionClient, shop: string, columns: string): ConnectionQuery {
  const table = admin.from('shopify_connections') as { select(columns: string): ConnectionQuery };
  return table.select(columns).eq('shop_domain', shop).is('uninstalled_at', null);
}

/** Conexión del negocio con la tienda del despliegue; null si no la tiene o está desinstalada. */
export async function storeConnection<T>(
  admin: ConnectionClient,
  businessId: string,
  shop: string,
  columns: string,
): Promise<T | null> {
  const { data, error } = await storeConnectionsQuery(admin, shop, columns).eq('business_id', businessId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as T | null;
}

/** business_id de las conexiones activas de la tienda con la marca `flag` activada. */
export async function storeBusinessIds(admin: ConnectionClient, shop: string, flag: string): Promise<string[]> {
  const { data, error } = await storeConnectionsQuery(admin, shop, 'business_id').eq(flag, true);
  if (error) throw error;
  return ((data ?? []) as { business_id: string }[]).map((c) => c.business_id);
}
