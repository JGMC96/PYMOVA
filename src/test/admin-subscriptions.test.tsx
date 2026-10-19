import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, from } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

import AdminSubscriptions from '@/pages/admin/AdminSubscriptions';

const tabla = (data: unknown) => ({
  select: () => ({
    order: () => Promise.resolve({ data, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
  }),
});

describe('AdminSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockImplementation((name: string) => {
      if (name === 'subscriptions') return tabla([{ id: 's1', business_id: 'b1', plan_id: 'p-trial', status: 'trialing', trial_ends_at: null, current_period_end: null }]);
      if (name === 'plans') return tabla([{ id: 'p-trial', name: 'Prueba', key: 'trial' }, { id: 'p-pro', name: 'Pro', key: 'pro' }]);
      if (name === 'businesses') return tabla([{ id: 'b1', name: 'Tienda' }]);
      throw new Error(`tabla inesperada: ${name}`);
    });
    rpc.mockResolvedValue({ data: {}, error: null });
  });

  it('«+14 días prueba» pide un motivo y no guarda hasta tenerlo', async () => {
    render(<AdminSubscriptions />);
    const boton = await screen.findByRole('button', { name: /\+14 días prueba/i });
    fireEvent.click(boton);

    const confirmar = await screen.findByRole('button', { name: /^Confirmar$/ });
    expect(confirmar).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Motivo/i), { target: { value: 'Cliente piloto' } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [nombre, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(nombre).toBe('admin_update_subscription');
    expect(args).toMatchObject({ _business_id: 'b1', _reason: 'Cliente piloto', _status: 'trialing' });
    expect(typeof args._trial_ends_at).toBe('string');
  });

  it('nunca escribe en subscriptions directamente', async () => {
    render(<AdminSubscriptions />);
    await screen.findByText('Tienda');
    const llamadasConUpdate = from.mock.results.filter(r => typeof (r.value as { update?: unknown }).update === 'function');
    expect(llamadasConUpdate).toHaveLength(0);
  });
});
