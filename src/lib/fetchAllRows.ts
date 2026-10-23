const PAGE = 1000;

/**
 * Todas las filas de una consulta, de 1.000 en 1.000: el servidor no devuelve más de 1.000
 * por petición y un negocio puede tener más tallas (Tuilus pasa de 1.200).
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}
