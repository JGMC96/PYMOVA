import { supabase } from '@/integrations/supabase/client';
import { STOCKAGILE_PILOT_BUSINESS_ID } from '../../supabase/functions/_shared/stockagile-core.ts';

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

/**
 * Crea en Shopify el pedido de las ventas de tienda pendientes (con etiqueta "pymova-tpv").
 * No bloquea: si falla, la venta queda pendiente y se reintenta en la siguiente venta.
 */
export async function pushShopifyPosOrders(businessId: string | undefined | null): Promise<void> {
  if (!businessId) return;
  try {
    await supabase.functions.invoke('shopify-pos-order', { body: { business_id: businessId } });
  } catch (error) {
    console.warn('No se pudo crear el pedido en Shopify ahora mismo', error);
  }
}

/** Registra en Shopify el reembolso de las devoluciones de tienda pendientes. No bloquea. */
export async function pushShopifyPosRefunds(businessId: string | undefined | null): Promise<void> {
  if (!businessId) return;
  try {
    await supabase.functions.invoke('shopify-pos-refund', { body: { business_id: businessId } });
  } catch (error) {
    console.warn('No se pudo registrar la devolución en Shopify ahora mismo', error);
  }
}

/**
 * Suma en Stockagile las devoluciones con reposición pendientes (piloto TUILUS, 0037).
 * No bloquea: si falla, quedan en cola y la tarea programada las reintenta.
 */
export async function pushStockagileReturns(businessId: string | undefined | null): Promise<void> {
  if (!businessId || businessId !== STOCKAGILE_PILOT_BUSINESS_ID) return;
  try {
    await supabase.functions.invoke('stockagile', { body: { action: 'push', business_id: businessId } });
  } catch (error) {
    console.warn('No se pudo sumar la devolución en Stockagile ahora mismo', error);
  }
}
