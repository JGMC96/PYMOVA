import { describe, expect, it } from 'vitest';
import {
  customerFields,
  customerFromWebhook,
  customerGid,
  fromQueryNode,
  planCustomerUpserts,
  type LocalClient,
  type ShopifyCustomer,
} from '../../supabase/functions/_shared/shopify-customers';

const GID = 'gid://shopify/Customer/100';
const cliente = (over: Partial<ShopifyCustomer> = {}): ShopifyCustomer => ({
  id: GID,
  firstName: 'Ana',
  lastName: 'López',
  email: 'Ana@Correo.es ',
  phone: '+34 600 000 000',
  ...over,
});
const local = (over: Partial<LocalClient> = {}): LocalClient => ({
  id: 'l1',
  name: 'Ana López',
  email: 'ana@correo.es',
  phone: '+34 600 000 000',
  external_id: GID,
  external_source: 'shopify',
  ...over,
});

describe('clientes de Shopify: datos', () => {
  it('normaliza correo, nombre y teléfono', () => {
    expect(customerFields(cliente())).toEqual({ name: 'Ana López', email: 'ana@correo.es', phone: '+34 600 000 000' });
    expect(customerFields(cliente({ firstName: null, lastName: ' ', phone: '' }))).toEqual({
      name: 'ana@correo.es',
      email: 'ana@correo.es',
      phone: null,
    });
    expect(customerFields(cliente({ firstName: null, lastName: null, email: null })).name).toBe('Cliente de Shopify');
  });

  it('lee los nodos de la consulta y los avisos', () => {
    expect(
      fromQueryNode({
        id: GID,
        firstName: 'Ana',
        lastName: null,
        defaultEmailAddress: { emailAddress: 'a@b.es' },
        defaultPhoneNumber: null,
      }),
    ).toEqual({ id: GID, firstName: 'Ana', lastName: null, email: 'a@b.es', phone: null });
    expect(customerGid(100)).toBe(GID);
    expect(customerGid('100')).toBe(GID);
    expect(customerGid(GID)).toBe(GID);
    expect(customerGid('abc')).toBeNull();
    expect(customerFromWebhook({ id: 100, first_name: 'Ana', last_name: 'López', email: 'a@b.es', phone: null })).toEqual({
      id: GID,
      firstName: 'Ana',
      lastName: 'López',
      email: 'a@b.es',
      phone: null,
    });
    expect(customerFromWebhook({})).toBeNull();
  });
});

describe('clientes de Shopify: emparejamiento', () => {
  it('un cliente ya enlazado sigue a Shopify y, si no cambia nada, no se toca', () => {
    expect(planCustomerUpserts([cliente()], [local()], { allowInsert: true })).toEqual([
      { kind: 'skip', gid: GID, reason: 'sin cambios' },
    ]);
    expect(
      planCustomerUpserts([cliente({ lastName: 'López Gil', email: 'nuevo@correo.es' })], [local()], { allowInsert: true }),
    ).toEqual([{ kind: 'update', gid: GID, id: 'l1', patch: { name: 'Ana López Gil', email: 'nuevo@correo.es' } }]);
  });

  it('sin nombre en Shopify no cambia el nombre de PYMOVA por el correo', () => {
    const plan = planCustomerUpserts([cliente({ firstName: null, lastName: null })], [local()], { allowInsert: true });
    expect(plan).toEqual([{ kind: 'skip', gid: GID, reason: 'sin cambios' }]);
  });

  it('enlaza un cliente local con el mismo correo sin pisar su nombre y solo rellena el teléfono', () => {
    const tpv = local({ id: 'l2', name: 'Ana (tienda)', phone: null, external_id: null, external_source: null });
    expect(planCustomerUpserts([cliente()], [tpv], { allowInsert: true })).toEqual([
      {
        kind: 'update',
        gid: GID,
        id: 'l2',
        patch: { external_id: GID, external_source: 'shopify', phone: '+34 600 000 000' },
      },
    ]);
  });

  it('un cliente local solo se enlaza con uno de Shopify', () => {
    const tpv = local({ id: 'l2', external_id: null, external_source: null });
    const otro = cliente({ id: 'gid://shopify/Customer/200' });
    const plan = planCustomerUpserts([cliente(), otro], [tpv], { allowInsert: true });
    expect(plan.map((p) => p.kind)).toEqual(['update', 'insert']);
  });

  it('crea los nuevos solo si se permite, y no repite el mismo cliente', () => {
    expect(planCustomerUpserts([cliente(), cliente()], [], { allowInsert: true })).toEqual([
      { kind: 'insert', gid: GID, fields: { name: 'Ana López', email: 'ana@correo.es', phone: '+34 600 000 000' } },
    ]);
    expect(planCustomerUpserts([cliente()], [], { allowInsert: false })).toEqual([
      { kind: 'skip', gid: GID, reason: 'no está en PYMOVA (aún no ha comprado)' },
    ]);
  });
});
