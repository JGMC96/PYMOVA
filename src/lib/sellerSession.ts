// Sesión de vendedor del TPV (quién atiende): reglas puras, sin red ni React.

/** PIN de 4 a 6 cifras, como exige set_employee_pin. */
export const PIN_PATTERN = /^[0-9]{4,6}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** Minutos sin tocar la pantalla tras los que el TPV vuelve a pedir el PIN. */
export const IDLE_LOCK_MINUTES = 5;
export const IDLE_LOCK_MS = IDLE_LOCK_MINUTES * 60 * 1000;

export function isIdleLocked(lastActivityMs: number, nowMs: number, limitMs = IDLE_LOCK_MS): boolean {
  return nowMs - lastActivityMs >= limitMs;
}

export interface PosEmployee {
  id: string;
  name: string;
  has_pin: boolean;
  is_active: boolean;
  has_account: boolean;
  user_id: string | null;
}

/** Dependientes que pueden identificarse en el TPV: activos y con PIN. */
export function sellableEmployees(employees: PosEmployee[]): PosEmployee[] {
  return employees.filter((e) => e.is_active && e.has_pin);
}

/** Si hay algún dependiente con PIN, el TPV exige vendedor para cobrar. */
export function requiresSeller(employees: PosEmployee[]): boolean {
  return sellableEmployees(employees).length > 0;
}

export interface StoredSeller {
  sessionId: string;
  employeeId: string;
  name: string;
  startedAt: number;
}

export function sellerStorageKey(businessId: string): string {
  return `pymova.seller.${businessId}`;
}

/** Lee la sesión guardada en sessionStorage; null si no es válida. */
export function parseStoredSeller(raw: string | null): StoredSeller | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSeller>;
    if (
      typeof v.sessionId === 'string' &&
      typeof v.employeeId === 'string' &&
      typeof v.name === 'string' &&
      typeof v.startedAt === 'number'
    ) {
      return { sessionId: v.sessionId, employeeId: v.employeeId, name: v.name, startedAt: v.startedAt };
    }
  } catch {
    // Valor corrupto: se ignora.
  }
  return null;
}

/** Texto del bloqueo por intentos fallidos. */
export function lockedMessage(lockedSeconds: number): string {
  const min = Math.max(1, Math.ceil(lockedSeconds / 60));
  return `Demasiados intentos. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'}.`;
}

/** ¿El error del servidor es por una sesión de vendedor caducada o inválida? */
export function isSellerSessionError(message: string | null | undefined): boolean {
  return /sesi[oó]n de vendedor/i.test(message ?? '');
}
