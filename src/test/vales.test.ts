import { describe, expect, it } from 'vitest';
import { normalizeVoucherCode, parseVoucherAmount, voucherApplied, voucherProblem } from '@/lib/vales';

describe('vales de tienda en el TPV', () => {
  it('normaliza el código escaneado o escrito', () => {
    expect(normalizeVoucherCode('  vale-abcd2345 ')).toBe('VALE-ABCD2345');
    expect(normalizeVoucherCode('nd2.vt259045')).toBe('ND2.VT259045');
  });

  it('el vale paga como mucho su saldo y el total de la venta', () => {
    expect(voucherApplied(60, 100, 200)).toBe(60);
    expect(voucherApplied(150, 100, 200)).toBe(100);
    expect(voucherApplied(100, 100, 40)).toBe(40);
    expect(voucherApplied(19.999, 50, 50)).toBe(20);
    expect(voucherApplied(0, 100, 50)).toBe(0);
    expect(voucherApplied(10, 0, 50)).toBe(0);
    expect(voucherApplied(10, 50, 0)).toBe(0);
  });

  it('dice por qué no se puede usar un vale', () => {
    const ok = { status: 'active', balance: 20, expired: false, expires_at: '2027-10-22T10:00:00Z' };
    expect(voucherProblem(ok)).toBeNull();
    expect(voucherProblem({ ...ok, status: 'void' })).toBe('Este vale está anulado');
    expect(voucherProblem({ ...ok, status: 'used', balance: 0 })).toBe('Este vale ya está gastado');
    expect(voucherProblem({ ...ok, balance: 0 })).toBe('Este vale ya está gastado');
    expect(voucherProblem({ ...ok, expired: true, expires_at: '2026-01-05T10:00:00Z' })).toBe('Este vale caducó el 5/1/2026');
  });

  it('lee el importe con coma o punto', () => {
    expect(parseVoucherAmount('19,90')).toBe(19.9);
    expect(parseVoucherAmount(' 20.5 ')).toBe(20.5);
    expect(parseVoucherAmount('0')).toBeNull();
    expect(parseVoucherAmount('-3')).toBeNull();
    expect(parseVoucherAmount('abc')).toBeNull();
  });
});
