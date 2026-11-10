import { describe, expect, it } from 'vitest';
import { catalogCompareAt, promoListPrice, promoPct, promoSavings } from '@/lib/promoPrice';
import { variantCompareAtPrice, type ShopifyVariantNode } from '../../supabase/functions/_shared/shopify-core';
import { renderTicketBody, type TicketDoc } from '@/lib/ticket';

const variante = (price: string, compareAtPrice?: string | null): ShopifyVariantNode => ({
  id: 'gid://shopify/ProductVariant/1',
  title: '36',
  sku: 'TFW23ZU000CH36',
  barcode: null,
  price,
  compareAtPrice,
  availableForSale: true,
  selectedOptions: [],
  inventoryItem: null,
});

describe('precio anterior desde Shopify', () => {
  it('se guarda si es mayor que el precio', () => {
    expect(variantCompareAtPrice(variante('143.20', '179.00'))).toBe(179);
  });

  it('vacío si falta, es igual, es menor o no es un número: así se borra al acabar la promoción', () => {
    expect(variantCompareAtPrice(variante('143.20', null))).toBeNull();
    expect(variantCompareAtPrice(variante('143.20'))).toBeNull();
    expect(variantCompareAtPrice(variante('179.00', '179.00'))).toBeNull();
    expect(variantCompareAtPrice(variante('179.00', '150.00'))).toBeNull();
    expect(variantCompareAtPrice(variante('179.00', ''))).toBeNull();
    expect(variantCompareAtPrice(variante('179.00', 'abc'))).toBeNull();
  });
});

describe('precio anterior en el TPV', () => {
  it('solo si es una rebaja', () => {
    expect(promoListPrice(143.2, 179)).toBe(179);
    expect(promoListPrice(143.2, '179.00')).toBe(179);
    expect(promoListPrice(179, 179)).toBeNull();
    expect(promoListPrice(179, null)).toBeNull();
    expect(promoListPrice(179, undefined)).toBeNull();
  });

  it('el % de rebaja', () => {
    expect(promoPct(143.2, 179)).toBe(20);
    expect(promoPct(96, 120)).toBe(20);
    expect(promoPct(111.2, 139)).toBe(20);
  });

  it('de la talla, o del producto si no tiene tallas', () => {
    const producto = { price: 143.2, compare_at_price: 179 };
    expect(catalogCompareAt(producto)).toBe(179);
    expect(catalogCompareAt(producto, { price: 143.2, compare_at_price: 179 })).toBe(179);
    // Una talla sin rebaja no hereda la del producto.
    expect(catalogCompareAt(producto, { price: 179, compare_at_price: null })).toBeNull();
    // Talla sin precio propio: el del producto.
    expect(catalogCompareAt(producto, { price: null, compare_at_price: 179 })).toBe(179);
  });

  it('lo ahorrado en una línea, por todas sus unidades', () => {
    expect(promoSavings({ quantity: 2, unitPrice: 143.2, listPrice: 179 })).toBe(71.6);
    expect(promoSavings({ quantity: 1, unitPrice: 179, listPrice: null })).toBe(0);
  });
});

describe('precio anterior en el ticket', () => {
  const venta = (lines: TicketDoc['lines']): TicketDoc => ({
    kind: 'sale', number: 'VTA-000001', createdAt: new Date(2026, 10, 10), taxRate: 21,
    total: lines.reduce((a, l) => a + l.total, 0), lines,
  });

  it('por línea: «Antes … · Ahorras …», y al final lo ahorrado en total', () => {
    const html = renderTicketBody({ name: 'Tienda' }, venta([
      { name: 'Botín Cannes · 36', quantity: 1, unitPrice: 143.2, total: 143.2, listPrice: 179 },
    ]));
    expect(html).toContain('Antes 179,00 €');
    expect(html).toContain('Ahorras 35,80 €');
    expect(html).toContain('Has ahorrado');
    expect(html).toMatch(/Has ahorrado<\/span><span>35,80 €/);
  });

  it('lo ahorrado al final suma la rebaja y el descuento del TPV', () => {
    const html = renderTicketBody({ name: 'Tienda' }, venta([
      { name: 'Botín Cannes · 36', quantity: 1, unitPrice: 143.2, total: 128.88, discount: 14.32, listPrice: 179 },
      { name: 'Crema', quantity: 1, unitPrice: 10, total: 9, discount: 1 },
    ]));
    expect(html).toMatch(/Has ahorrado<\/span><span>51,12 €/);
  });

  it('sin rebajas ni descuentos, nada de esto', () => {
    const html = renderTicketBody({ name: 'Tienda' }, venta([{ name: 'Crema', quantity: 1, unitPrice: 10, total: 10 }]));
    expect(html).not.toContain('Antes');
    expect(html).not.toContain('Has ahorrado');
  });

  it('un abono no dice lo ahorrado', () => {
    const html = renderTicketBody({ name: 'Tienda' }, {
      ...venta([{ name: 'Botín', quantity: 1, unitPrice: 143.2, total: 143.2, discount: 0 }]), kind: 'refund',
    });
    expect(html).not.toContain('Has ahorrado');
  });
});
