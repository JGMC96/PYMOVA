// Emparejamientos de stock (shopify_inventory_levels) de unos artículos concretos.
//
// Leer la tabla entera de un negocio no vale: la API de la base de datos devuelve como
// mucho 1.000 filas por consulta, y con el catálogo completo hay más (2.527 en Tuilus el
// 21/10/2026). Los artículos que quedaban fuera se daban por «no emparejados»: la venta
// no bajaba el stock en Shopify y el pedido salía sin el artículo enlazado.
// Aquí se piden solo las filas de las variantes y productos que hacen falta, por
// tandas de ids y paginando cada tanda. Sin dependencias de Deno (se prueba con Vitest);
// el lector de la base de datos está en shopify-levels-db.ts.

export type LevelColumn = 'local_variant_id' | 'local_product_id';

/** Lee una página (filas `from`..`to`) de los niveles cuyo `column` está en `ids`. */
export type LevelPageFetcher<T> = (column: LevelColumn, ids: string[], from: number, to: number) => Promise<T[]>;

/** Ids por tanda: cabe en la URL de la consulta. */
export const LEVEL_IDS_PER_QUERY = 100;
/** Filas por página: por debajo del tope de 1.000 de la API. */
export const LEVEL_PAGE_SIZE = 500;

const uniq = (ids: Iterable<string | null | undefined>) => [...new Set([...ids].filter((id): id is string => !!id))];

/**
 * Niveles de las variantes y productos indicados. Los de variante se buscan por
 * `local_variant_id`; los de producto (para los artículos sin variante emparejada), por
 * `local_product_id`. Sin repetidos (por `id`).
 */
export async function loadLevelsFor<T extends { id: string }>(
  fetchPage: LevelPageFetcher<T>,
  ids: { variantIds?: Iterable<string | null | undefined>; productIds?: Iterable<string | null | undefined> },
): Promise<T[]> {
  const byId = new Map<string, T>();
  const load = async (column: LevelColumn, all: string[]) => {
    for (let i = 0; i < all.length; i += LEVEL_IDS_PER_QUERY) {
      const chunk = all.slice(i, i + LEVEL_IDS_PER_QUERY);
      for (let from = 0; ; from += LEVEL_PAGE_SIZE) {
        const page = await fetchPage(column, chunk, from, from + LEVEL_PAGE_SIZE - 1);
        for (const row of page) byId.set(row.id, row);
        if (page.length < LEVEL_PAGE_SIZE) break;
      }
    }
  };
  await load('local_variant_id', uniq(ids.variantIds ?? []));
  await load('local_product_id', uniq(ids.productIds ?? []));
  return [...byId.values()];
}
