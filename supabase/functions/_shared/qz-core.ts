// Firma de las peticiones a QZ Tray (RSA con SHA-512, en base64). Puro: sin Deno ni red.
// La clave privada llega de los secretos de Supabase; nunca se devuelve ni se escribe en logs.

/** Los secretos pueden llegar con los saltos de línea como «\n» literales o sin ellos. */
export function normalizePem(raw: string): string {
  return raw.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

/** PEM PKCS#8 → bytes. Solo admite «BEGIN PRIVATE KEY», el formato que da QZ Tray. */
export function pkcs8FromPem(pem: string): Uint8Array {
  const clean = normalizePem(pem);
  const match = clean.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!match) throw new Error('La clave privada no está en formato PKCS#8');
  const binary = atob(match[1].replace(/\s+/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Firma `message` y devuelve la firma en base64, como la pide QZ Tray. */
export async function signQzRequest(privateKeyPem: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8FromPem(privateKeyPem) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** Negocios con permiso de firma: sin lista, todos; con lista (ids separados por comas), solo esos. */
export function businessAllowed(allowList: string | undefined, businessId: string): boolean {
  const ids = (allowList ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.length === 0 || ids.includes(businessId.toLowerCase());
}
