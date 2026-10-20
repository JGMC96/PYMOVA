import { describe, expect, it } from 'vitest';
import {
  IDLE_LOCK_MS,
  isIdleLocked,
  isSellerSessionError,
  isValidPin,
  lockedMessage,
  parseStoredSeller,
  requiresSeller,
  sellableEmployees,
  sellerStorageKey,
  type PosEmployee,
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

describe('bloqueo por inactividad', () => {
  it('se bloquea a los 5 minutos sin actividad', () => {
    expect(isIdleLocked(0, IDLE_LOCK_MS - 1)).toBe(false);
    expect(isIdleLocked(0, IDLE_LOCK_MS)).toBe(true);
    expect(isIdleLocked(1_000, 2_000, 500)).toBe(true);
  });
});

describe('dependientes del TPV', () => {
  it('solo cuentan los activos con PIN, y con alguno el TPV exige vendedor', () => {
    const lista = [emp({ id: 'a' }), emp({ id: 'b', has_pin: false }), emp({ id: 'c', is_active: false })];
    expect(sellableEmployees(lista).map((e) => e.id)).toEqual(['a']);
    expect(requiresSeller(lista)).toBe(true);
    expect(requiresSeller([emp({ has_pin: false })])).toBe(false);
    expect(requiresSeller([])).toBe(false);
  });
});

describe('sesión guardada', () => {
  it('lee solo valores completos y bien formados', () => {
    const ok = { sessionId: 's', employeeId: 'e', name: 'Ana', startedAt: 1 };
    expect(parseStoredSeller(JSON.stringify(ok))).toEqual(ok);
    expect(parseStoredSeller(null)).toBeNull();
    expect(parseStoredSeller('{')).toBeNull();
    expect(parseStoredSeller(JSON.stringify({ sessionId: 's' }))).toBeNull();
    expect(sellerStorageKey('b1')).toBe('pymova.seller.b1');
  });
});

describe('mensajes', () => {
  it('redondea el bloqueo hacia arriba en minutos y reconoce el error de sesión', () => {
    expect(lockedMessage(30)).toBe('Demasiados intentos. Espera 1 minuto.');
    expect(lockedMessage(300)).toBe('Demasiados intentos. Espera 5 minutos.');
    expect(isSellerSessionError('La sesión de vendedor no es válida: vuelve a introducir el PIN')).toBe(true);
    expect(isSellerSessionError('Abre la caja')).toBe(false);
    expect(isSellerSessionError(null)).toBe(false);
  });
});
