import { supabase } from '@/integrations/supabase/client';

/**
 * Envía a Shopify los ajustes de stock pendientes del negocio.
 * Se llama tras cobrar una venta o registrar una devolución con reposición.
 * Nunca bloquea al usuario: si falla, el ajuste queda en cola y se reintenta.
 */
export async function pushShopifyStock(businessId: string | undefined | null): Promise<void> {
  if (!businessId) return;
  try {
    await supabase.functions.invoke('shopify-inventory-push', {
      body: { business_id: businessId },
    });
  } catch (error) {
    console.warn('No se pudo actualizar el stock en Shopify ahora mismo', error);
  }
}
