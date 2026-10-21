import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';

// Supabase falso: guarda el listener de sesión y responde a las consultas del contexto.
const { auth, from, calls } = vi.hoisted(() => {
  const calls: Record<string, number> = {};
  let listener: ((event: string, session: unknown) => void) | null = null;
  const tables: Record<string, unknown> = {
    business_members: [{ role: 'owner', business_id: 'b1', businesses: { id: 'b1', name: 'TUILUS' } }],
    profiles: { active_business_id: 'b1' },
    business_modules: [{ module_id: 'm1', is_enabled: true, modules: { key: 'retail' } }],
  };
  const from = (table: string) => {
    calls[table] = (calls[table] ?? 0) + 1;
    const result = { data: tables[table] ?? null, error: null };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      single: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return q;
  };
  const auth = {
    emit: (event: string, session: unknown) => listener?.(event, session),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: () => (listener = null) } } };
    },
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
  };
  return { auth, from, calls };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth, from, rpc: () => Promise.resolve({ data: null, error: null }) },
}));

import { BusinessProvider } from '@/contexts/BusinessContext';
import { RequireBusiness } from '@/components/auth/RequireBusiness';

function Carrito() {
  const [unidades, setUnidades] = useState(0);
  return (
    <button type="button" onClick={() => setUnidades((n) => n + 1)}>
      Carrito: {unidades}
    </button>
  );
}

const app = () =>
  render(
    <MemoryRouter>
      <BusinessProvider>
        <RequireBusiness>
          <Carrito />
        </RequireBusiness>
      </BusinessProvider>
    </MemoryRouter>,
  );

describe('El panel no se recarga al refrescar la sesión', () => {
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    localStorage.clear();
  });

  it('un refresco de sesión (mismo usuario, objeto nuevo) no vacía el carrito ni vuelve a cargar los negocios', async () => {
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Carrito: 0' }));
    expect(screen.getByRole('button', { name: 'Carrito: 1' })).toBeTruthy();
    const cargas = calls.business_members;

    await act(async () => {
      auth.emit('TOKEN_REFRESHED', { user: { id: 'u1' } });
      auth.emit('SIGNED_IN', { user: { id: 'u1' } });
    });

    expect(screen.getByRole('button', { name: 'Carrito: 1' })).toBeTruthy();
    expect(calls.business_members).toBe(cargas);
  });

  it('si entra otra persona, sí se vuelven a cargar sus negocios', async () => {
    app();
    await screen.findByRole('button', { name: 'Carrito: 0' });
    const cargas = calls.business_members;
    await act(async () => {
      auth.emit('SIGNED_IN', { user: { id: 'u2' } });
    });
    await waitFor(() => expect(calls.business_members).toBe(cargas + 1));
  });
});
