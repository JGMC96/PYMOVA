import { useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { isSellerSessionError } from '@/lib/sellerSession';

/** Cliente tal como lo ve el TPV (pos_search_clients, 0034). */
export interface PosClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  receipt_email_consent: boolean;
}

export interface NewPosClient {
  name: string;
  email?: string;
  phone?: string;
  receiptConsent: boolean;
}

/** El cliente puede recibir el ticket por correo: tiene correo y lo aceptó. */
export const canEmailReceipt = (c: Pick<PosClient, 'email' | 'receipt_email_consent'> | null | undefined) =>
  !!c?.email && c.receipt_email_consent;

/** Mensaje de error de una edge function (el cuerpo trae `{ error }`). */
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // sin cuerpo JSON
    }
  }
  return (error as { message?: string } | null)?.message || 'No se pudo enviar el ticket';
}

/**
 * Clientes desde el TPV: buscar, dar de alta lo mínimo, apuntar si aceptan el ticket
 * por correo, ponerlos en una venta y enviar el ticket. Con dependientes con PIN, cada
 * cambio va a nombre de la persona conectada (se pide el PIN si no hay nadie).
 */
export function usePosClients() {
  const { activeBusiness } = useBusiness();
  const sellerSession = useSellerSession();

  /** undefined = se canceló el PIN; null = el negocio no usa dependientes. */
  const sellerSessionId = useCallback(
    async (purpose: string): Promise<string | null | undefined> => {
      const pick = await sellerSession.chooseSeller(purpose);
      if (pick.cancelled) return undefined;
      return pick.seller?.sessionId ?? null;
    },
    [sellerSession],
  );

  const fail = useCallback(
    (message: string, sessionId: string | null | undefined) => {
      if (sessionId && isSellerSessionError(message)) sellerSession.dropSession(sessionId);
      toast.error(message);
    },
    [sellerSession],
  );

  const searchClients = useCallback(
    async (query: string): Promise<PosClient[]> => {
      if (!activeBusiness?.id || query.trim().length < 2) return [];
      // RPC nueva de la 0034: `as never` hasta que se regenere types.ts.
      const { data, error } = await supabase.rpc('pos_search_clients' as never, {
        _business_id: activeBusiness.id,
        _query: query.trim(),
      } as never);
      if (error) {
        toast.error('No se pudo buscar el cliente');
        return [];
      }
      return ((data ?? null) as unknown as PosClient[] | null) ?? [];
    },
    [activeBusiness?.id],
  );

  const createClient = useCallback(
    async (c: NewPosClient): Promise<{ client: PosClient; created: boolean } | null> => {
      if (!activeBusiness?.id) return null;
      const sid = await sellerSessionId('el cliente');
      if (sid === undefined) return null;
      const { data, error } = await supabase.rpc('pos_find_or_create_client' as never, {
        _business_id: activeBusiness.id,
        _name: c.name,
        _email: c.email?.trim() || null,
        _phone: c.phone?.trim() || null,
        _receipt_consent: c.receiptConsent,
        _seller_session_id: sid,
      } as never);
      if (error) {
        fail(error.message || 'No se pudo guardar el cliente', sid);
        return null;
      }
      const rows = (data ?? null) as unknown as
        | { client_id: string; name: string; email: string | null; receipt_email_consent: boolean; created: boolean }[]
        | null;
      const row = rows?.[0];
      if (!row) return null;
      if (!row.created) toast.info(`Ya existía: ${row.name}`);
      return {
        client: {
          id: row.client_id,
          name: row.name,
          email: row.email,
          phone: c.phone?.trim() || null,
          receipt_email_consent: row.receipt_email_consent,
        },
        created: row.created,
      };
    },
    [activeBusiness?.id, sellerSessionId, fail],
  );

  const setReceiptConsent = useCallback(
    async (clientId: string, consent: boolean, email?: string | null): Promise<boolean> => {
      const sid = await sellerSessionId('el cliente');
      if (sid === undefined) return false;
      const { error } = await supabase.rpc('pos_set_receipt_consent' as never, {
        _client_id: clientId,
        _consent: consent,
        _email: email?.trim() || null,
        _seller_session_id: sid,
      } as never);
      if (error) {
        fail(error.message || 'No se pudo guardar el consentimiento', sid);
        return false;
      }
      return true;
    },
    [sellerSessionId, fail],
  );

  const setSaleClient = useCallback(
    async (saleId: string, clientId: string): Promise<boolean> => {
      const sid = await sellerSessionId('el cliente de la venta');
      if (sid === undefined) return false;
      const { error } = await supabase.rpc('pos_set_sale_client' as never, {
        _sale_id: saleId,
        _client_id: clientId,
        _seller_session_id: sid,
      } as never);
      if (error) {
        fail(error.message || 'No se pudo poner el cliente en la venta', sid);
        return false;
      }
      return true;
    },
    [sellerSessionId, fail],
  );

  /** Envía el ticket al correo del cliente de la venta (lo decide el servidor). */
  const sendReceipt = useCallback(async (saleId: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('send-transactional-email', {
      body: { templateName: 'sale-receipt', saleId },
    });
    if (error) {
      toast.error(await functionErrorMessage(error));
      return false;
    }
    if (data?.success === false) {
      toast.error('Ese correo no admite envíos: el cliente se dio de baja de los correos');
      return false;
    }
    toast.success('Ticket enviado por correo');
    return true;
  }, []);

  /** Cliente de una venta ya cobrada, para enviarle el ticket. */
  const fetchSaleClient = useCallback(async (saleId: string): Promise<PosClient | null> => {
    const { data } = await supabase
      .from('sales')
      .select('client_id, clients(id, name, email, phone, receipt_email_consent)')
      .eq('id', saleId)
      .maybeSingle();
    const row = (data ?? null) as unknown as { clients: PosClient | null } | null;
    return row?.clients ?? null;
  }, []);

  return { searchClients, createClient, setReceiptConsent, setSaleClient, sendReceipt, fetchSaleClient };
}
