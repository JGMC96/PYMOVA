// Lector de `shopify_inventory_levels` para loadLevelsFor (ver shopify-levels.ts).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { LevelPageFetcher } from './shopify-levels.ts';

/** Lector de páginas de `shopify_inventory_levels` de un negocio con las columnas dadas. */
export function levelPages<T extends { id: string }>(
  admin: SupabaseClient,
  businessId: string,
  columns: string,
): LevelPageFetcher<T> {
  return async (column, ids, from, to) => {
    const { data, error } = await admin
      .from('shopify_inventory_levels')
      .select(`id, ${columns}`)
      .eq('business_id', businessId)
      .in(column, ids)
      .order('id')
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as unknown as T[];
  };
}
