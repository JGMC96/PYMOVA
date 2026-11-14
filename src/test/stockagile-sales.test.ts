import { describe, expect, it } from 'vitest';
import { customerName, isStoreOrder, mapPosOrder, type StockagilePosOrder } from '../../supabase/functions/_shared/stockagile-sales';

const ticket = (over: Partial<StockagilePosOrder> = {}): StockagilePosOrder => ({
  id: 4242,
  autocode: 'VT2510377',
  created_at: '2026-10-23T11:05:00+02:00',
  deleted: false,
  is_devolution: false,
  devolution_of: null,
  total: '155.00',
  site: null,
  source_warehouse: { name: 'Tienda Valencia' },
  customer: { name: '', first_name: 'Ana', last_name: 'Pérez', email: ' ANA@Ejemplo.test ', phone: '600111222' },
  pos_order_payment_methods: [{ payment_method_name: 'Tarjeta', amount: 155 }],
  pos_order_product_variants: [
    { product_name: 'Zueco Bolonia Piel Negro', product_variant_size_name: '39', product_variant_color_name: 'Negro', barcode: '9600000000017', amount: 1, price_incl_tax: 149, total: '149.00' },
    { product_name: 'Calcetines', product_variant_size_name: '', amount: 1, price_incl_tax: 6, total: '6.00' },
    { product_name: 'Línea borrada', amount: 1, total: '99', deleted: true },
  ],
  ...over,
});

const sinVale = { is_gift_card: false, gift_card_code: null, gift_card_charged_id: null, gift_card_consumed_id: null };

describe('ventas de Stockagile', () => {
  it('solo los tickets de la tienda (no los pedidos web)', () => {
    expect(isStoreOrder(ticket())).toBe(true);
    expect(isStoreOrder(ticket({ site: 3 }))).toBe(false);
  });

  it('nombre de la clienta', () => {
    expect(customerName({ name: 'Ana P.' })).toBe('Ana P.');
    expect(customerName({ name: ' ', first_name: 'Ana', last_name: 'Pérez' })).toBe('Ana Pérez');
    expect(customerName({ commercial_name: 'Tienda X' })).toBe('Tienda X');
    expect(customerName(null)).toBeNull();
  });

  it('convierte el ticket con su clienta, pagos y líneas con la talla', () => {
    const { sale, items } = mapPosOrder('negocio', ticket(), '2026-10-23T10:00:00Z');
    expect(sale).toMatchObject({
      business_id: 'negocio', external_id: 4242, number: 'VT2510377', total: 155, is_return: false,
      warehouse_name: 'Tienda Valencia', payment_methods: 'Tarjeta', customer_name: 'Ana Pérez',
      customer_email: 'ana@ejemplo.test', customer_phone: '600111222', deleted: false,
    });
    expect(items).toEqual([
      { product_name: 'Zueco Bolonia Piel Negro - 39', size: '39', color: 'Negro', barcode: '9600000000017', quantity: 1, unit_price: 149, total: 149, ...sinVale },
      { product_name: 'Calcetines', size: null, color: null, barcode: null, quantity: 1, unit_price: 6, total: 6, ...sinVale },
    ]);
  });

  it('las devoluciones van en negativo y apuntan al ticket original', () => {
    const { sale } = mapPosOrder('negocio', ticket({ is_devolution: true, devolution_of: 4000, total: -6, customer: null, pos_order_payment_methods: [{ payment_method_name: 'Efectivo' }, { payment_method_name: 'Efectivo' }] }));
    expect(sale).toMatchObject({ is_return: true, return_of_external_id: 4000, total: -6, customer_email: null, payment_methods: 'Efectivo' });
    const anulada = mapPosOrder('negocio', ticket({ is_negative: true, negative_of: 4100, total: -155 })).sale;
    expect(anulada).toMatchObject({ is_return: true, return_of_external_id: 4100 });
  });

  it('el vale emitido en una devolución guarda su código y la tarjeta que carga (0062)', () => {
    const { items } = mapPosOrder('negocio', ticket({
      is_devolution: true, devolution_of: 4000, total: 0,
      pos_order_product_variants: [
        { product_name: 'Zueco Bolonia Piel Negro', product_variant_size_name: '39', barcode: '9600000000017', amount: -1, total: '-149.00' },
        { product_name: 'Vale', amount: 1, total: '149.00', is_gift_card: true, gift_card_code: ' TG-00123 ', charged_gift_card: 77, consumed_gift_card: null },
      ],
    }));
    expect(items[1]).toMatchObject({
      product_name: 'Vale', total: 149, is_gift_card: true, gift_card_code: 'TG-00123', gift_card_charged_id: 77, gift_card_consumed_id: null,
    });
    expect(items[0]).toMatchObject(sinVale);
  });

  it('el vale gastado en una venta guarda la tarjeta que gasta; ids raros, a null', () => {
    const { items } = mapPosOrder('negocio', ticket({
      pos_order_product_variants: [
        { product_name: 'Vale', amount: 1, total: '-50.00', is_gift_card: true, gift_card_code: 'TG-00123', consumed_gift_card: 77 },
        { product_name: 'Vale', amount: 1, total: '-5.00', is_gift_card: true, gift_card_code: '', charged_gift_card: 0, consumed_gift_card: 'abc' as never },
      ],
    }));
    expect(items[0]).toMatchObject({ total: -50, gift_card_code: 'TG-00123', gift_card_charged_id: null, gift_card_consumed_id: 77 });
    expect(items[1]).toMatchObject({ gift_card_code: null, gift_card_charged_id: null, gift_card_consumed_id: null });
  });
});
