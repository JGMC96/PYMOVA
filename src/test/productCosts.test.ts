import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Productos sin coste en la consulta; el coste aparte y solo con permiso. Sin costes
// cargados, editar o crear no manda `cost_price` (no se borra el que tenga).
const { rpc, updates, inserts } = vi.hoisted(() => ({
  rpc: vi.fn(),
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/supabase/client', () => {
  const rows = [{ id: 'p1', business_id: 'b1', name: 'Zueco', price: 100, is_active: true }];
  const query = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      or: () => q,
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return q;
  };
  const write = (list: Record<string, unknown>[]) => (payload: Record<string, unknown>) => {
    list.push(payload);
    const w = { eq: () => w, then: (ok: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
    return w;
  };
  return {
    supabase: {
      rpc,
      from: () => ({ ...query(), update: write(updates), insert: write(inserts) }),
    },
  };
});
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ activeBusinessId: 'b1', user: { id: 'u1' } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useProducts } from '@/hooks/useProducts';

const form = { name: 'Zueco', price: 100, cost_price: null };

beforeEach(() => {
  rpc.mockReset();
  updates.length = 0;
  inserts.length = 0;
  rpc.mockReturnValue({
    range: () => Promise.resolve({ data: [{ kind: 'product', id: 'p1', cost_price: 40 }], error: null }),
  });
});

describe('useProducts y el coste', () => {
  it('sin permiso: no pide costes ni los manda al guardar', async () => {
    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.products[0].cost_price).toBeNull();

    await act(async () => {
      await result.current.updateProduct('p1', form);
      await result.current.createProduct(form);
    });
    expect(updates[0]).not.toHaveProperty('cost_price');
    expect(inserts[0]).not.toHaveProperty('cost_price');
  });

  it('con permiso: el coste viene de la RPC y se guarda', async () => {
    const { result } = renderHook(() => useProducts({ withCosts: true }));
    await waitFor(() => expect(result.current.products[0]?.cost_price).toBe(40));
    expect(rpc).toHaveBeenCalledWith('get_catalog_costs', { _business_id: 'b1', _product_id: null });

    await act(async () => {
      await result.current.updateProduct('p1', { ...form, cost_price: 45 });
    });
    expect(updates[0]).toMatchObject({ cost_price: 45 });
  });
});
