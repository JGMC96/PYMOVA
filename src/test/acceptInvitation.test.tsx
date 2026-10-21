import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { rpc, refreshBusinesses, setActiveBusiness, navigate, ctx } = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshBusinesses: vi.fn(),
  setActiveBusiness: vi.fn(),
  navigate: vi.fn(),
  ctx: { user: { id: 'u1' } as { id: string } | null, isAuthLoading: false },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ ...ctx, refreshBusinesses, setActiveBusiness }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

import AcceptInvitation from '@/pages/AcceptInvitation';

const page = () => (
  <MemoryRouter initialEntries={['/invite/tok123']}>
    <Routes>
      <Route path="/invite/:token" element={<AcceptInvitation />} />
    </Routes>
  </MemoryRouter>
);

describe('Aceptar invitación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.user = { id: 'u1' };
    ctx.isAuthLoading = false;
  });

  it('termina aunque la página se vuelva a pintar mientras espera (sesión refrescada)', async () => {
    let resolve!: (v: { data: string; error: null }) => void;
    rpc.mockReturnValue(new Promise((r) => (resolve = r)));

    const { rerender } = render(page());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('accept_business_invitation', { _token: 'tok123' }));

    // Supabase entrega un objeto de usuario nuevo (mismo id) al refrescar la sesión.
    ctx.user = { id: 'u1' };
    rerender(page());
    await act(async () => resolve({ data: 'b1', error: null }));

    expect(await screen.findByText('Te has unido al negocio correctamente.')).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(refreshBusinesses).toHaveBeenCalled();
    expect(setActiveBusiness).toHaveBeenCalledWith('b1');
  });

  it('muestra el error de la invitación', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Esta invitación ya no está disponible' } });
    render(page());
    expect(await screen.findByText('Esta invitación ya no está disponible')).toBeTruthy();
  });

  it('sin sesión, guarda la invitación y lleva a entrar', async () => {
    ctx.user = null;
    render(page());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/auth?invite=1', { replace: true }));
    expect(rpc).not.toHaveBeenCalled();
  });
});
