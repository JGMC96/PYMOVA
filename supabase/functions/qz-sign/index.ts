// Certificado y firma para QZ Tray (impresión directa del TPV). La clave privada solo vive aquí,
// en los secretos: QZ_PRIVATE_KEY y QZ_CERTIFICATE. QZ_ALLOWED_BUSINESSES (ids separados por comas)
// limita qué negocios pueden pedir firmas: quien tiene una firma puede hablar con los QZ Tray que
// confían en el certificado.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { businessAllowed, normalizePem, signQzRequest } from '../_shared/qz-core.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_REQUEST_LENGTH = 4096;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'No autorizado' }, 401);

    const body = (await req.json().catch(() => ({}))) ?? {};
    const businessId = String(body.business_id ?? '');
    if (!UUID.test(businessId)) return json({ error: 'Falta el negocio activo' }, 400);
    const { data: isMember } = await userClient.rpc('is_member_of_business', { _business_id: businessId });
    if (!isMember) return json({ error: 'Sin acceso a este negocio' }, 403);
    if (!businessAllowed(Deno.env.get('QZ_ALLOWED_BUSINESSES'), businessId)) {
      return json({ error: 'La impresión directa no está activada para este negocio' }, 403);
    }

    if (body.action === 'certificate') {
      const certificate = Deno.env.get('QZ_CERTIFICATE');
      if (!certificate) return json({ error: 'Falta configurar el certificado de QZ Tray' }, 503);
      return json({ certificate: normalizePem(certificate) });
    }

    if (body.action === 'sign') {
      const request = body.request;
      if (typeof request !== 'string' || !request || request.length > MAX_REQUEST_LENGTH) {
        return json({ error: 'Petición de firma no válida' }, 400);
      }
      const privateKey = Deno.env.get('QZ_PRIVATE_KEY');
      if (!privateKey) return json({ error: 'Falta configurar la clave de QZ Tray' }, 503);
      return json({ signature: await signQzRequest(privateKey, request) });
    }

    return json({ error: 'Acción no válida' }, 400);
  } catch {
    // Sin detalles: el error podría llevar parte de la clave.
    return json({ error: 'No se ha podido firmar la petición de QZ Tray' }, 500);
  }
});
