// Escritura de clientes de Shopify en `clients` (ver shopify-customers.ts).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planCustomerUpserts, type LocalClient, type ShopifyCustomer } from './shopify-customers.ts';

export interface CustomerUpsertResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { gid: string; message: string }[];
}

const LOCAL_COLUMNS = 'id, name, email, phone, external_id, external_source';

/** Crea, enlaza o actualiza en PYMOVA un lote de clientes de Shopify. */
export async function upsertShopifyCustomers(
  admin: SupabaseClient,
  businessId: string,
  customers: ShopifyCustomer[],
  opts: { allowInsert: boolean; createdBy?: string | null },
): Promise<CustomerUpsertResult> {
  const result: CustomerUpsertResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (customers.length === 0) return result;

  const gids = [...new Set(customers.map((c) => c.id))];
  const emails = [
    ...new Set(customers.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => !!e)),
  ];
  const [byGid, byEmail] = await Promise.all([
    admin.from('clients').select(LOCAL_COLUMNS).eq('business_id', businessId).eq('external_source', 'shopify').in('external_id', gids),
    emails.length
      ? admin.from('clients').select(LOCAL_COLUMNS).eq('business_id', businessId).is('external_id', null).in('email', emails)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byGid.error) throw byGid.error;
  if (byEmail.error) throw byEmail.error;
  const locals = [...((byGid.data ?? []) as LocalClient[]), ...((byEmail.data ?? []) as LocalClient[])];

  const plan = planCustomerUpserts(customers, locals, { allowInsert: opts.allowInsert });
  const now = new Date().toISOString();

  const inserts = plan.filter((p) => p.kind === 'insert');
  if (inserts.length) {
    const rows = inserts.map((p) => ({
      business_id: businessId,
      ...p.fields,
      external_id: p.gid,
      external_source: 'shopify',
      created_by: opts.createdBy ?? null,
    }));
    const { error } = await admin.from('clients').insert(rows);
    if (!error) {
      result.created += rows.length;
    } else {
      // Choque con otro proceso a la vez (índice único por id de Shopify): uno a uno.
      for (const row of rows) {
        const { error: oneError } = await admin.from('clients').insert(row);
        if (!oneError) {
          result.created += 1;
          continue;
        }
        if (oneError.code === '23505') {
          result.skipped += 1;
          continue;
        }
        result.errors.push({ gid: row.external_id, message: oneError.message });
      }
    }
  }

  for (const p of plan) {
    if (p.kind === 'skip') {
      result.skipped += 1;
    } else if (p.kind === 'update') {
      const { error } = await admin.from('clients').update({ ...p.patch, updated_at: now }).eq('id', p.id);
      if (error) result.errors.push({ gid: p.gid, message: error.message });
      else result.updated += 1;
    }
  }
  return result;
}

/** Cliente borrado en Shopify: se desactiva y se le quitan el correo y el teléfono (sus ventas se quedan). */
export async function retireShopifyCustomer(admin: SupabaseClient, businessId: string, gid: string): Promise<number> {
  const { data, error } = await admin
    .from('clients')
    .update({ is_active: false, email: null, phone: null, updated_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('external_source', 'shopify')
    .eq('external_id', gid)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}
