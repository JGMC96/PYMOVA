import { describe, expect, it } from 'vitest';
import {
  activeSellers,
  connectedElsewhere,
  authorizers,
  discountPct,
  hasPermission,
  isAuthorizationError,
  type PosPermission,
  isSellerSessionError,
  isValidPin,
  lockedMessage,
  minutesLeft,
  parseStoredSellers,
  requiresSeller,
  SELLER_SESSION_MS,
  sellableEmployees,
  sellerChoice,
  sellerStorageKey,
  withSeller,
  type PosEmployee,
  type StoredSeller,
} from '@/lib/sellerSession';

const emp = (p: Partial<PosEmployee>): PosEmployee => ({
  id: 'e1',
  name: 'Ana',
  has_pin: true,
  is_active: true,
  has_account: false,
  user_id: null,
  ...p,
});

const conectado = (employeeId: string, startedAt: number): StoredSeller => ({
  sessionId: `s-${employeeId}-${startedAt}`,
  employeeId,
  name: employeeId,
  startedAt,
  expiresAt: startedAt + SELLER_SESSION_MS,
});

describe('isValidPin', () => {
  it('acepta de 4 a 6 cifras y nada más', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});

describe('dependientes del TPV', () => {
  it('solo cuentan los activos con PIN, y con alguno no se vende sin identificarse', () => {
    const lista = [emp({ id: 'a' }), emp({ id: 'b', has_pin: false }), emp({ id: 'c', is_active: false })];
    expect(sellableEmployees(lista).map((e) => e.id)).toEqual(['a']);
    expect(requiresSeller(lista)).toBe(true);
    expect(requiresSeller([emp({ has_pin: false })])).toBe(false);
    expect(requiresSeller([])).toBe(false);
  });
});

describe('personas conectadas', () => {
  it('duran 3 horas y salen por orden de llegada', () => {
    const t0 = 1_000_000;
    const lista = [conectado('juan', t0 + 10), conectado('ana', t0)];
    expect(activeSellers(lista, t0 + 60_000).map((s) => s.employeeId)).toEqual(['ana', 'juan']);
    expect(activeSellers(lista, t0 + SELLER_SESSION_MS).map((s) => s.employeeId)).toEqual(['juan']);
    expect(activeSellers(lista, t0 + SELLER_SESSION_MS + 10)).toEqual([]);
    expect(minutesLeft(lista[1], t0)).toBe(180);
    expect(minutesLeft(lista[1], t0 + SELLER_SESSION_MS + 1)).toBe(0);
  });

  it('al cobrar: nadie → PIN, una persona → esa, varias → preguntar', () => {
    expect(sellerChoice([])).toBe('login');
    expect(sellerChoice([conectado('ana', 1)])).toBe('auto');
    expect(sellerChoice([conectado('ana', 1), conectado('juan', 2)])).toBe('ask');
  });

  it('una persona solo aparece una vez: volver a conectarse sustituye su sesión', () => {
    const lista = withSeller([conectado('ana', 1), conectado('juan', 2)], conectado('ana', 3));
    expect(lista.map((s) => s.sessionId)).toEqual(['s-juan-2', 's-ana-3']);
  });

  it('la lista guardada se lee solo si tiene la forma correcta', () => {
    const ok = conectado('ana', 1);
    expect(parseStoredSellers(JSON.stringify([ok, { sessionId: 'x' }, null]))).toEqual([ok]);
    expect(parseStoredSellers(JSON.stringify(ok))).toEqual([]);
    expect(parseStoredSellers(null)).toEqual([]);
    expect(parseStoredSellers('{')).toEqual([]);
    expect(sellerStorageKey('b1')).toBe('pymova.sellers.b1');
  });
});

describe('mensajes', () => {
  it('redondea el bloqueo hacia arriba en minutos y reconoce los errores de sesión', () => {
    expect(lockedMessage(30)).toBe('Demasiados intentos. Espera 1 minuto.');
    expect(lockedMessage(300)).toBe('Demasiados intentos. Espera 5 minutos.');
    expect(isSellerSessionError('La sesión de vendedor no es válida: vuelve a introducir el PIN')).toBe(true);
    expect(isSellerSessionError('Falta la sesión de vendedor: identifícate con tu PIN en el TPV')).toBe(true);
    expect(isSellerSessionError('Abre la caja')).toBe(false);
    expect(isSellerSessionError(null)).toBe(false);
  });
});

describe('permisos por persona', () => {
  const perm = (p: Partial<PosPermission>): PosPermission => ({
    employee_id: 'e1',
    name: 'Ana',
    is_owner: false,
    has_account: false,
    customized: false,
    max_discount_pct: 10,
    can_return: false,
    can_close_register: false,
    can_edit_catalog: false,
    can_see_costs: false,
    can_adjust_stock: false,
    ...p,
  });

  it('calcula el % de descuento como el servidor', () => {
    expect(discountPct(20, 80)).toBe(20);
    expect(discountPct(10, 89.5)).toBe(10.05);
    expect(discountPct(0, 100)).toBe(0);
    expect(discountPct(5, 0)).toBe(100);
  });

  it('sin permiso o por encima del tope, hace falta autorización', () => {
    expect(hasPermission(perm({}), 'discount', 10)).toBe(true);
    expect(hasPermission(perm({}), 'discount', 10.01)).toBe(false);
    expect(hasPermission(perm({}), 'return')).toBe(false);
    expect(hasPermission(perm({ can_close_register: true }), 'close_register')).toBe(true);
    expect(hasPermission(perm({}), 'adjust_stock')).toBe(false);
    expect(hasPermission(perm({ can_adjust_stock: true }), 'adjust_stock')).toBe(true);
    expect(hasPermission(null, 'discount', 0)).toBe(false);
  });

  it('autoriza quien tiene PIN y el permiso suficiente', () => {
    const permisos = [
      perm({ employee_id: 'ana' }),
      perm({ employee_id: 'luis', max_discount_pct: 30, can_return: true }),
      perm({ employee_id: 'sinpin', max_discount_pct: 100, can_return: true }),
    ];
    const empleados = [emp({ id: 'ana' }), emp({ id: 'luis', name: 'Luis' }), emp({ id: 'sinpin', has_pin: false })];
    expect(authorizers(permisos, empleados, 'discount', 20).map((e) => e.id)).toEqual(['luis']);
    expect(authorizers(permisos, empleados, 'discount', 40)).toEqual([]);
    expect(authorizers(permisos, empleados, 'return').map((e) => e.id)).toEqual(['luis']);
    expect(isAuthorizationError('Necesita autorización: esta persona no puede hacer devoluciones')).toBe(true);
    expect(isAuthorizationError('PIN incorrecto')).toBe(false);
  });
});

describe('conectados en otros dispositivos', () => {
  const ahora = Date.UTC(2026, 9, 21, 10, 0);
  const servidor = [
    { employee_id: 'luis', name: 'Luis', expires_at: '2026-10-21T12:00:00Z' },
    { employee_id: 'ana', name: 'Ana', expires_at: '2026-10-21T12:30:00Z' },
    { employee_id: 'marta', name: 'Marta', expires_at: '2026-10-21T09:00:00Z' },
    { employee_id: 'Álvaro', name: 'Álvaro', expires_at: '2026-10-21T11:00:00Z' },
  ];

  it('quita a quien está conectado en este TPV y a quien ya caducó', () => {
    const r = connectedElsewhere(servidor, [{ employeeId: 'ana' }], ahora);
    expect(r.map((s) => s.name)).toEqual(['Álvaro', 'Luis']);
    expect(r[1]).toEqual({ employeeId: 'luis', name: 'Luis', expiresAt: Date.UTC(2026, 9, 21, 12, 0) });
  });

  it('sin nadie en el servidor no hay nadie fuera', () => {
    expect(connectedElsewhere([], [{ employeeId: 'ana' }], ahora)).toEqual([]);
  });
});
