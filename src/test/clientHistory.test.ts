import { describe, expect, it } from 'vitest';
import { eur, isVoidPurchase, posClientSummaryText, purchaseStatusLabel, usualSizes } from '@/lib/clientHistory';

describe('ficha de clienta', () => {
  it('etiqueta de estado', () => {
    expect(purchaseStatusLabel({ channel: 'store', status: 'done', net: 100, total: 100 })).toBeNull();
    expect(purchaseStatusLabel({ channel: 'store', status: 'returned', net: 50, total: 100 })).toBe('Devolución parcial');
    expect(purchaseStatusLabel({ channel: 'store', status: 'returned', net: 0, total: 100 })).toBe('Devuelta');
    expect(purchaseStatusLabel({ channel: 'online', status: 'shipped', net: 100, total: 100 })).toBe('Enviado');
    expect(purchaseStatusLabel({ channel: 'online', status: 'refunded', net: 0, total: 100 })).toBe('Reembolsado');
  });

  it('compras que no cuentan', () => {
    expect(isVoidPurchase({ net: 0 })).toBe(true);
    expect(isVoidPurchase({ net: 12.5 })).toBe(false);
  });

  it('talla habitual, con empates', () => {
    expect(usualSizes([])).toEqual([]);
    expect(usualSizes([{ size: '38', units: 3 }, { size: '39', units: 1 }])).toEqual(['38']);
    expect(usualSizes([{ size: '38', units: 2 }, { size: '39', units: 2 }])).toEqual(['38', '39']);
  });

  it('línea corta del TPV', () => {
    expect(posClientSummaryText(0, 0, [], null)).toBe('Primera compra');
    expect(posClientSummaryText(3, 369, ['38'], '20 oct 2026')).toBe('3 compras · 369,00 € · talla 38 · última 20 oct 2026');
    expect(posClientSummaryText(1, 50, ['38', '39'], null)).toBe('1 compra · 50,00 € · talla 38/39');
  });

  it('importes en euros', () => {
    expect(eur(1234.5)).toMatch(/1\.?234,50 €/);
    expect(eur(null)).toBe('0,00 €');
  });
});
