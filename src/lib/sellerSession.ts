// Personas conectadas al TPV (quién vende): reglas puras, sin red ni React.
// Quien mete su PIN queda conectado SELLER_SESSION_HOURS en ese TPV. Al cobrar: si no
// hay nadie se pide el PIN, si hay una persona se usa esa y si hay varias se pregunta.

/** PIN de 4 a 6 cifras, como exigen set_employee_pin y change_own_pin. */
export const PIN_PATTERN = /^[0-9]{4,6}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** Horas que dura una persona conectada tras meter su PIN (igual que en el servidor, 0028). */
export const SELLER_SESSION_HOURS = 3;
export const SELLER_SESSION_MS = SELLER_SESSION_HOURS * 60 * 60 * 1000;

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

/** Si hay algún dependiente con PIN, no se vende ni se devuelve sin identificarse. */
export function requiresSeller(employees: PosEmployee[]): boolean {
  return sellableEmployees(employees).length > 0;
}

export interface StoredSeller {
  sessionId: string;
  employeeId: string;
  name: string;
  startedAt: number;
  expiresAt: number;
}

export function sellerStorageKey(businessId: string): string {
  return `pymova.sellers.${businessId}`;
}

function isStoredSeller(v: unknown): v is StoredSeller {
  const s = v as Partial<StoredSeller> | null;
  return (
    !!s &&
    typeof s.sessionId === 'string' &&
    typeof s.employeeId === 'string' &&
    typeof s.name === 'string' &&
    typeof s.startedAt === 'number' &&
    typeof s.expiresAt === 'number'
  );
}

/** Lee la lista guardada; ignora lo que no tenga la forma correcta. */
export function parseStoredSellers(raw: string | null): StoredSeller[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isStoredSeller) : [];
  } catch {
    return [];
  }
}

/** Conectados que no han caducado, por orden de llegada. */
export function activeSellers(list: StoredSeller[], nowMs: number): StoredSeller[] {
  return list.filter((s) => s.expiresAt > nowMs).sort((a, b) => a.startedAt - b.startedAt);
}

/** Añade o sustituye a una persona (una sola sesión por persona en el TPV). */
export function withSeller(list: StoredSeller[], seller: StoredSeller): StoredSeller[] {
  return [...list.filter((s) => s.employeeId !== seller.employeeId), seller];
}

export type SellerChoice = 'login' | 'auto' | 'ask';

/** Al cobrar: nadie conectado → PIN; una persona → esa; varias → preguntar quién. */
export function sellerChoice(active: StoredSeller[]): SellerChoice {
  if (active.length === 0) return 'login';
  return active.length === 1 ? 'auto' : 'ask';
}

/** Minutos que le quedan a una persona conectada (redondeo hacia arriba). */
export function minutesLeft(seller: StoredSeller, nowMs: number): number {
  return Math.max(0, Math.ceil((seller.expiresAt - nowMs) / 60_000));
}

/** Texto del bloqueo por intentos fallidos. */
export function lockedMessage(lockedSeconds: number): string {
  const min = Math.max(1, Math.ceil(lockedSeconds / 60));
  return `Demasiados intentos. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'}.`;
}

/** ¿El error del servidor es por una sesión de vendedor que falta, caducó o no vale? */
export function isSellerSessionError(message: string | null | undefined): boolean {
  return /sesi[oó]n de vendedor/i.test(message ?? '');
}

// ---------------------------------------------------------------------------
// Permisos por persona (0030)
// ---------------------------------------------------------------------------

export type PosAction = 'discount' | 'return' | 'close_register';

export interface PosPermission {
  employee_id: string;
  name: string;
  is_owner: boolean;
  has_account: boolean;
  customized: boolean;
  max_discount_pct: number;
  can_return: boolean;
  can_close_register: boolean;
}

/** Descuento de la venta en %, igual que el servidor: descuento / (cobrado + descuento). */
export function discountPct(discount: number, charged: number): number {
  const gross = charged + discount;
  if (discount <= 0 || gross <= 0) return 0;
  return Math.round((discount / gross) * 10000) / 100;
}

/** ¿Esta persona puede hacerlo sin autorización? (sin datos, se pide autorización) */
export function hasPermission(p: PosPermission | null | undefined, action: PosAction, amount = 0): boolean {
  if (!p) return false;
  if (action === 'discount') return Number(p.max_discount_pct) >= amount;
  if (action === 'return') return p.can_return;
  return p.can_close_register;
}

/** Quién puede autorizar: personas con PIN y con el permiso (o tope) suficiente. */
export function authorizers(
  permissions: PosPermission[],
  employees: PosEmployee[],
  action: PosAction,
  amount = 0,
): PosEmployee[] {
  const withPin = new Map(sellableEmployees(employees).map((e) => [e.id, e]));
  return permissions
    .filter((p) => withPin.has(p.employee_id) && hasPermission(p, action, amount))
    .map((p) => withPin.get(p.employee_id)!);
}

/** ¿El servidor pide autorización? */
export function isAuthorizationError(message: string | null | undefined): boolean {
  return /necesita autorizaci[oó]n/i.test(message ?? '');
}
