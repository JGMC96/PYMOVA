// Empuja a Shopify los ajustes de stock generados en Pymova (ventas en tienda y devoluciones).
// La cola vive en `shopify_inventory_pushes`; el envío está en _shared/shopify-stock-push.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { serviceClient, ShopifyError } from '../_shared/shopify-client.ts';
import { consumeTicket, hasTicket } from '../_shared/scheduled-ticket.ts';
import { MAX_ATTEMPTS, pushForBusiness } from '../_shared/shopify-stock-push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Negocios con envíos de stock pendientes (para las tareas programadas). */
async function businessesWithPendingPushes(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from('shopify_inventory_pushes')
    .select('business_id')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .limit(1000);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.business_id as string))];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const admin = serviceClient();

    // Tareas programadas (pg_cron): sin JWT, con ticket de un solo uso en el cuerpo.
    if (hasTicket(body)) {
      if (!(await consumeTicket(admin, body, 'push-stock'))) return json({ error: 'No autorizado' }, 401);
      const ids = await businessesWithPendingPushes(admin);
      const results = [];
      for (const id of ids) results.push({ business_id: id, ...(await pushForBusiness(admin, id)) });
      return json({ status: 'ok', results });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const businessId = String(body.business_id ?? '');
    if (!businessId) return json({ error: 'Falta el negocio activo' }, 400);

    const { data: isMember } = await userClient.rpc('is_member_of_business', {
      _business_id: businessId,
    });
    const { data: isSuper } = await userClient.rpc('is_super_admin');
    if (!isMember && !isSuper) return json({ error: 'Sin acceso a este negocio' }, 403);

    return json(await pushForBusiness(admin, businessId));
  } catch (error) {
    const status = error instanceof ShopifyError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return json({ error: message }, status);
  }
});
