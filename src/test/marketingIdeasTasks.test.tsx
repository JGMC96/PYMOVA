import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { format } from 'date-fns';
import { MarketingIdeas } from '@/components/marketing/MarketingIdeas';
import { MarketingTasks } from '@/components/marketing/MarketingTasks';
import { PostFormDialog } from '@/components/marketing/PostFormDialog';
import type { MarketingPost, MarketingTask } from '@/types/database';

// jsdom no trae ResizeObserver y los controles de Radix lo usan.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const hoy = new Date();
const dia = (offset: number) => format(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + offset), 'yyyy-MM-dd');

const equipo = [
  { user_id: 'ana', full_name: 'Ana' },
  { user_id: 'luis', full_name: 'Luis' },
];

const publicacion = (id: string, status: MarketingPost['status'], created_by: string): MarketingPost => ({
  id,
  business_id: 'b1',
  title: `Publicación ${id}`,
  copy: null,
  content_type: 'reel',
  channels: ['instagram'],
  status,
  scheduled_at: null,
  assignee_id: null,
  reference_url: null,
  hashtags: null,
  notes: null,
  campaign_id: null,
  created_by,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
});

const tarea = (id: string, assignee_id: string, due_on: string | null, done_at: string | null = null): MarketingTask => ({
  id,
  business_id: 'b1',
  title: `Tarea ${id}`,
  notes: null,
  assignee_id,
  due_on,
  done_at,
  done_by: null,
  campaign_id: null,
  post_id: null,
  created_by: 'admin',
  created_at: '2026-10-28T00:00:00Z',
});

describe('Ideas', () => {
  it('enseña solo las ideas, con quién las propuso', () => {
    render(
      <MarketingIdeas
        posts={[publicacion('a', 'idea', 'ana'), publicacion('b', 'scheduled', 'luis')]}
        teamMembers={equipo}
        campaigns={[]}
        onNew={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Publicación a')).toBeInTheDocument();
    expect(screen.getByText('Propuesta por Ana')).toBeInTheDocument();
    expect(screen.queryByText('Publicación b')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva idea/ })).toBeInTheDocument();
  });

  it('el personal crea una idea sin poder cambiar el estado', () => {
    render(
      <PostFormDialog open onOpenChange={vi.fn()} teamMembers={equipo} onSubmit={vi.fn(async () => true)} isSubmitting={false} ideaOnly />,
    );
    expect(screen.getByRole('heading', { name: 'Nueva idea' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Estado/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });
});

describe('Tareas', () => {
  const tareas = [
    tarea('vieja', 'ana', dia(-2)),
    tarea('de-luis', 'luis', dia(1)),
    tarea('hecha', 'ana', dia(-5), '2026-10-20T10:00:00Z'),
  ];
  const props = {
    tasks: tareas,
    teamMembers: equipo,
    campaigns: [],
    onNew: vi.fn(),
    onSelect: vi.fn(),
    onToggle: vi.fn(async () => true),
  };

  it('el personal empieza con sus tareas pendientes y ve las vencidas', () => {
    render(<MarketingTasks {...props} currentUserId="ana" isAdmin={false} />);

    expect(screen.getByText('Tarea vieja')).toBeInTheDocument();
    expect(screen.getByText(/Vencida/)).toBeInTheDocument();
    expect(screen.queryByText('Tarea de-luis')).not.toBeInTheDocument();
    expect(screen.queryByText('Tarea hecha')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nueva tarea/ })).not.toBeInTheDocument();
  });

  it('marca la suya como hecha, pero no la de otra persona', () => {
    render(<MarketingTasks {...props} currentUserId="ana" isAdmin={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Todas' }));

    const mia = screen.getByRole('checkbox', { name: /Marcar «Tarea vieja»/ });
    const ajena = screen.getByRole('checkbox', { name: /Marcar «Tarea de-luis»/ });
    expect(ajena).toBeDisabled();
    fireEvent.click(mia);
    expect(props.onToggle).toHaveBeenCalledWith('vieja', true);
  });

  it('un administrador ve todas, también las hechas, y puede crear', () => {
    render(<MarketingTasks {...props} currentUserId="admin" isAdmin />);
    expect(screen.getByText('Tarea de-luis')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    const lista = screen.getByRole('list');
    expect(within(lista).getByText('Tarea hecha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva tarea/ })).toBeInTheDocument();
  });
});
