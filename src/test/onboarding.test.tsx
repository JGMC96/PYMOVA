import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { rpc, from, refreshBusinesses, navigate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  refreshBusinesses: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, from } }));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ user: { id: 'u1' }, refreshBusinesses }),
}));
vi.mock('@/hooks/useSuperAdmin', () => ({ useSuperAdmin: () => ({ isSuperAdmin: false }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

import Onboarding from '@/pages/Onboarding';
import { toast } from 'sonner';

const enviar = (nombre: string) => {
  render(
    <MemoryRouter>
      <Onboarding />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/Nombre del negocio/i), { target: { value: nombre } });
  fireEvent.submit(screen.getByLabelText(/Nombre del negocio/i).closest('form')!);
};

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crea el negocio con la RPC create_business y sin inserts desde el cliente', async () => {
    rpc.mockResolvedValue({ data: 'b1', error: null });

    enviar('  Mi Tienda  ');

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_business', { _name: 'Mi Tienda', _industry: undefined });
    expect(from).not.toHaveBeenCalled();
    expect(refreshBusinesses).toHaveBeenCalled();
  });

  it('muestra el error de la RPC y no navega', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Has alcanzado el máximo de 10 negocios propios' } });

    enviar('Otra');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Has alcanzado el máximo de 10 negocios propios'),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
