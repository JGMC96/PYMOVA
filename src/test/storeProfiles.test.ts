import { describe, expect, it } from 'vitest';
import { PAYMENT_LABELS, REFUND_LABELS, STORE_PROFILE_LIST, getStoreProfile, refundMethods } from '@/lib/storeProfiles';
import { methodLabel } from '@/lib/informes';
import { paymentLabels } from '@/lib/ticket';

describe('formas de pago del TPV', () => {
  it('ningún perfil cobra por transferencia', () => {
    for (const p of STORE_PROFILE_LIST) {
      expect(p.paymentMethods, p.key).not.toContain('transfer');
      expect(p.paymentMethods, p.key).toEqual(expect.arrayContaining(['cash', 'card']));
    }
  });

  it('la zapatería cobra en efectivo o con tarjeta', () => {
    expect(getStoreProfile('shoe_store').paymentMethods).toEqual(['cash', 'card']);
  });
});

describe('formas de reembolso de las devoluciones de tienda', () => {
  it('las del cobro más el vale, sin transferencia', () => {
    expect(refundMethods(getStoreProfile('shoe_store'))).toEqual(['cash', 'card', 'store_credit']);
  });

  it('con el vale el primero (tickets de Stockagile)', () => {
    expect(refundMethods(getStoreProfile('shoe_store'), true)).toEqual(['store_credit', 'cash', 'card']);
  });

  it('el vale no sale dos veces', () => {
    expect(refundMethods({ paymentMethods: ['cash', 'store_credit'] })).toEqual(['cash', 'store_credit']);
  });

  it('cada una tiene su nombre', () => {
    for (const m of refundMethods(getStoreProfile('general'))) expect(REFUND_LABELS[m]).toBeTruthy();
    expect(REFUND_LABELS.store_credit).toBe('Vale de tienda');
  });
});

describe('lo ya guardado con transferencia se sigue leyendo', () => {
  it('en caja, informes y tickets', () => {
    expect(PAYMENT_LABELS.transfer).toBe('Transferencia');
    expect(methodLabel('transfer')).toBe('Transferencia');
    expect(paymentLabels.transfer).toBe('Transferencia');
  });
});
