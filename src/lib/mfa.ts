// Verificación en dos pasos (TOTP, códigos de una app como Google Authenticator) con Supabase
// Auth. El servidor exige el código a quien la tiene activada (0049).
import { supabase } from '@/integrations/supabase/client';

export interface TotpFactor {
  id: string;
  status: 'verified' | 'unverified';
  friendlyName?: string;
}

/** Solo dígitos, como mucho 6 (los códigos TOTP). */
export function cleanTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

/** Mensaje en castellano para los errores de Supabase al verificar un código. */
export function mfaErrorMessage(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid') && m.includes('code')) return 'El código no es correcto o ha caducado. Prueba con el siguiente.';
  if (m.includes('expired')) return 'El código ha caducado. Prueba con el siguiente.';
  if (m.includes('rate') || m.includes('too many')) return 'Demasiados intentos. Espera un momento y vuelve a probar.';
  return message || 'No se pudo comprobar el código.';
}

/** Factores TOTP de la cuenta (verificados y a medias). */
export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all ?? [])
    .filter((f) => f.factor_type === 'totp')
    .map((f) => ({ id: f.id, status: f.status as TotpFactor['status'], friendlyName: f.friendly_name ?? undefined }));
}

/** Comprueba un código; si es bueno, la sesión pasa a aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return error ? { ok: false, error: mfaErrorMessage(error.message) } : { ok: true, error: null };
}
