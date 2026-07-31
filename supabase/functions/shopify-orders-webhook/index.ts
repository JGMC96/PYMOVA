// Webhooks de Shopify: HMAC + encolado inmediato.
// Responde 200 en cuanto el evento queda registrado; el trabajo real ocurre
// después (drainWebhookQueue), de modo que Shopify nunca ve un timeout.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhookHmac, normalizeShopDomain } from '../_shared/shopify-client.ts';
import { webhookDedupeKey } from '../_shared/shopify-core.ts';
import { drainWebhookQueue } from '../_shared/shopify-webhooks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const valid = await verifyWebhookHmac(rawBody, req.headers.get('x-shopify-hmac-sha256'));
  if (!valid) {
    console.warn('Webhook rechazado: firma HMAC inválida');
    return new Response('Unauthorized', { status: 401 });
  }

  const topic = (req.headers.get('x-shopify-topic') ?? 'unknown').toLowerCase();
  const shopDomain = normalizeShopDomain(req.headers.get('x-shopify-shop-domain') ?? '');
  const eventId = req.headers.get('x-shopify-webhook-id');

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: connection } = await admin
      .from('shopify_connections')
      .select('business_id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();

    const dedupeKey = webhookDedupeKey(eventId, topic, payload);

    // Idempotencia: un mismo webhook nunca se encola dos veces.
    const { data: seen } = await admin
      .from('integration_webhook_events')
      .select('id')
      .eq('integration_key', 'shopify')
      .eq('event_id', dedupeKey)
      .maybeSingle();
    if (seen) return new Response('ok', { status: 200 });

    const { data: inserted } = await admin
      .from('integration_webhook_events')
      .insert({
        business_id: connection?.business_id ?? null,
        integration_key: 'shopify',
        topic,
        shop_domain: shopDomain,
        external_id:
          typeof payload.admin_graphql_api_id === 'string' ? payload.admin_graphql_api_id : null,
        event_id: dedupeKey,
        status: 'pending',
        message: 'En cola',
        payload,
      })
      .select('id')
      .maybeSingle();

    // Procesado en segundo plano: la respuesta 200 no espera a Shopify.
    if (inserted) {
      const work = drainWebhookQueue(admin, 5).catch((err) =>
        console.error('drainWebhookQueue error:', err instanceof Error ? err.message : err),
      );
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(work);
      }
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    console.error('shopify-orders-webhook error:', errorMessage);
    // Se responde 200 para que Shopify no reintente indefinidamente un fallo propio;
    // el evento queda registrado como error para su revisión.
    await admin.from('integration_webhook_events').insert({
      integration_key: 'shopify',
      topic,
      shop_domain: shopDomain,
      event_id: eventId ? `${eventId}:error` : null,
      status: 'error',
      message: errorMessage.slice(0, 500),
      payload: { topic },
      processed_at: new Date().toISOString(),
    });
    return new Response('ok', { status: 200 });
  }
});
