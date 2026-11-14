import { describe, expect, it } from 'vitest';
import {
  canOfferReturn, lineRefund, parseVariantSearch, resolvedVariant, returnItems, stockagileVoucherPaid, suggestedRefundMethod,
  type ReturnableLine,
} from '@/lib/stockagileReturn';

describe('pagado con un vale de Stockagile', () => {
  it('suma las líneas «Vale» en negativo', () => {
    expect(stockagileVoucherPaid([
      { product_name: 'Botín Cannes - 37', total: 179 },
      { product_name: 'Vale', total: '-120.50' },
      { product_name: 'vale', total: -10 },
    ])).toBe(130.5);
  });

  it('sin vale gastado, 0: ni un vale vendido ni otras líneas en negativo cuentan', () => {
    expect(stockagileVoucherPaid([{ product_name: 'Vale', total: 50 }])).toBe(0);
    expect(stockagileVoucherPaid([{ product_name: 'Zueco Valencia - 38', total: -96 }])).toBe(0);
    expect(stockagileVoucherPaid([{ product_name: 'Valeria - 38', total: -96 }])).toBe(0);
    expect(stockagileVoucherPaid([{ product_name: null, total: null }])).toBe(0);
    expect(stockagileVoucherPaid([])).toBe(0);
  });
});

const line = (over: Partial<ReturnableLine> = {}): ReturnableLine => ({
  line_key: 'b:1',
  product_name: 'Zueco - 39',
  size: '39',
  color: null,
  barcode: '1',
  quantity: 1,
  line_total: 149,
  returned_stockagile: 0,
  returned_pymova: 0,
  remaining: 1,
  variant_id: 'v39',
  variant_match: 'code',
  variant_name: 'Zueco · 39',
  ...over,
});

describe('importe a devolver', () => {
  it('lo cobrado en la línea', () => {
    expect(lineRefund(line(), 1)).toBe(149);
    expect(lineRefund(line(), 0)).toBe(0);
  });

  it('varias devoluciones parciales suman el total exacto, contando las de los dos sistemas', () => {
    const base = { quantity: 3, line_total: 100, remaining: 3 };
    const uno = lineRefund(line(base), 1);
    const dos = lineRefund(line({ ...base, returned_stockagile: 1 }), 1);
    const tres = lineRefund(line({ ...base, returned_stockagile: 1, returned_pymova: 1 }), 1);
    expect(uno + dos + tres).toBeCloseTo(100, 2);
  });
});

describe('método sugerido', () => {
  it('el del ticket', () => {
    expect(suggestedRefundMethod('Metálico')).toBe('cash');
    expect(suggestedRefundMethod('Tarjeta')).toBe('card');
  });

  it('con los dos o sin dato, ninguno', () => {
    expect(suggestedRefundMethod('Metálico · Tarjeta')).toBeNull();
    expect(suggestedRefundMethod(null)).toBeNull();
    expect(suggestedRefundMethod('Bizum')).toBeNull();
  });
});

describe('botón de devolver', () => {
  const ahora = new Date('2026-11-09T12:00:00Z');

  it('hasta 180 días y con algo comprado', () => {
    expect(canOfferReturn('2026-05-20T12:00:00Z', [{ quantity: 1 }], ahora)).toBe(true);
    expect(canOfferReturn('2026-05-01T12:00:00Z', [{ quantity: 1 }], ahora)).toBe(false);
    expect(canOfferReturn('2026-11-01T12:00:00Z', [{ quantity: -1 }], ahora)).toBe(false);
    expect(canOfferReturn('2026-11-01T12:00:00Z', [], ahora)).toBe(false);
  });
});

describe('a qué talla vuelve el par', () => {
  it('por código, directa', () => {
    expect(resolvedVariant(line(), undefined, false)).toBe('v39');
  });

  it('por nombre, solo si se confirma', () => {
    const porNombre = line({ variant_match: 'name' });
    expect(resolvedVariant(porNombre, undefined, false)).toBeNull();
    expect(resolvedVariant(porNombre, undefined, true)).toBe('v39');
  });

  it('la elegida a mano manda', () => {
    expect(resolvedVariant(line(), { id: 'v40', label: 'Zueco · 40' }, false)).toBe('v40');
  });

  it('sin candidato, ninguna', () => {
    expect(resolvedVariant(line({ variant_id: null, variant_match: null }), undefined, true)).toBeNull();
  });
});

describe('lo que se envía', () => {
  it('solo las líneas con unidades, cada una con su talla', () => {
    const a = line();
    const b = line({ line_key: 'n:varios', variant_id: null, variant_match: null });
    const c = line({ line_key: 'b:3' });
    expect(returnItems([a, b, c], { 'b:1': 1, 'n:varios': 2, 'b:3': 0 }, {}, {})).toEqual([
      { line_key: 'b:1', quantity: 1, variant_id: 'v39' },
      { line_key: 'n:varios', quantity: 2, variant_id: null },
    ]);
  });
});

describe('buscar la talla', () => {
  it('un código escaneado', () => {
    expect(parseVariantSearch(' 9600000000017 ')).toEqual({ barcode: '9600000000017' });
  });

  it('nombre con la talla al final', () => {
    expect(parseVariantSearch('bolonia  negro 39')).toEqual({ name: 'bolonia negro', size: '39' });
    expect(parseVariantSearch('calcetines rojo 39-44')).toEqual({ name: 'calcetines rojo', size: '39-44' });
  });

  it('solo nombre', () => {
    expect(parseVariantSearch('bolonia')).toEqual({ name: 'bolonia', size: null });
  });

  it('demasiado corto', () => {
    expect(parseVariantSearch('a')).toBeNull();
  });
});
