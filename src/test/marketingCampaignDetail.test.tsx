import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MarketingCampaign, MarketingGoal, MarketingPost, MarketingTask } from '@/types/database';

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ activeBusiness: { id: 'b1', currency: 'EUR' } }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CampaignDetailDialog } from '@/components/marketing/CampaignDetailDialog';
import { CampaignFormDialog } from '@/components/marketing/CampaignFormDialog';

const campaign: MarketingCampaign = {
  id: 'c1',
  business_id: 'b1',
  name: 'Black Friday 2026',
  kind: 'campaign',
  starts_on: '2026-11-27',
  ends_on: '2026-11-30',
  color: null,
  goal: 'Vender 300 pares',
  notes: 'Qué ofrecemos: −20 % en botas\nPara quién: clientas de Valencia',
  created_at: '2026-11-14T00:00:00Z',
};

const task = (id: string, title: string, extra: Partial<MarketingTask> = {}): MarketingTask => ({
  id,
  business_id: 'b1',
  title,
  notes: null,
  assignee_id: null,
  due_on: '2026-11-25',
  done_at: null,
  done_by: null,
  campaign_id: 'c1',
  post_id: null,
  created_by: null,
  created_at: '2026-11-14T00:00:00Z',
  ...extra,
});

const tasks = [
  task('t1', 'Banner y portada de la web', { assignee_id: 'u2' }),
  task('t2', 'Emails en Klaviyo', { done_at: '2026-11-14T10:00:00Z' }),
  task('t3', 'Tarea de otra campaña', { campaign_id: 'c2' }),
];

const goal: MarketingGoal = {
  id: 'g1',
  business_id: 'b1',
  title: 'Ventas Black Friday',
  metric: 'sales',
  target: 10000,
  current: 2500,
  starts_on: '2026-11-27',
  ends_on: '2026-11-30',
  campaign_id: 'c1',
  notes: null,
  created_at: '2026-11-14T00:00:00Z',
};

const post: MarketingPost = {
  id: 'p1',
  business_id: 'b1',
  title: 'Reel botas rebajadas',
  copy: null,
  content_type: 'reel',
  channels: ['instagram'],
  status: 'scheduled',
  scheduled_at: '2026-11-27T10:00:00Z',
  assignee_id: null,
  reference_url: null,
  hashtags: null,
  notes: null,
  campaign_id: 'c1',
  created_by: null,
  created_at: '2026-11-14T00:00:00Z',
  updated_at: '2026-11-14T00:00:00Z',
};

const handlers = () => ({
  onOpenChange: vi.fn(),
  onEdit: vi.fn(),
  onSelectPost: vi.fn(),
  onSelectTask: vi.fn(),
  onSelectGoal: vi.fn(),
  onNewTask: vi.fn(),
  onNewGoal: vi.fn(),
  onToggleTask: vi.fn(async () => true),
  onAddTemplateTasks: vi.fn(async () => 9),
});

const renderDetail = (isAdmin: boolean, h = handlers(), currentUserId: string | null = 'u1') => {
  render(
    <CampaignDetailDialog
      open
      campaign={campaign}
      posts={[post]}
      tasks={tasks}
      goals={[goal]}
      teamMembers={[{ user_id: 'u2', full_name: 'Lucía' } as never]}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      {...h}
    />,
  );
  return h;
};

describe('Ficha de campaña', () => {
  it('junta el brief, los objetivos, las tareas y las publicaciones de la campaña', () => {
    renderDetail(true);

    expect(screen.getByText('Black Friday 2026')).toBeInTheDocument();
    expect(screen.getByText('Vender 300 pares')).toBeInTheDocument();
    expect(screen.getByText(/−20 % en botas/)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Tareas · 1 de 2 hechas')).toBeInTheDocument();
    expect(screen.getByText('Lucía')).toBeInTheDocument();
    expect(screen.queryByText('Tarea de otra campaña')).not.toBeInTheDocument();
    expect(screen.getByText('Reel botas rebajadas')).toBeInTheDocument();
  });

  it('un administrador crea la lista de Black Friday y añade tareas y objetivos', async () => {
    const h = renderDetail(true);

    fireEvent.click(screen.getByRole('button', { name: 'Crear tareas de Black Friday' }));
    await waitFor(() => expect(h.onAddTemplateTasks).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Tarea$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Objetivo$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
    expect(h.onNewTask).toHaveBeenCalled();
    expect(h.onNewGoal).toHaveBeenCalled();
    expect(h.onEdit).toHaveBeenCalled();
  });

  it('el personal ve la ficha sin botones de crear y solo marca sus tareas', async () => {
    const h = renderDetail(false, handlers(), 'u2');

    expect(screen.queryByRole('button', { name: 'Crear tareas de Black Friday' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Objetivo$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver datos/ })).toBeInTheDocument();

    expect(screen.getByRole('checkbox', { name: 'Marcar «Banner y portada de la web» como hecha' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Desmarcar «Emails en Klaviyo»' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Marcar «Banner y portada de la web» como hecha' }));
    await waitFor(() => expect(h.onToggleTask).toHaveBeenCalledWith('t1', true));
  });
});


describe('Plantilla de brief', () => {
  it('rellena las notas vacías con las preguntas del brief', () => {
    render(<CampaignFormDialog open onOpenChange={vi.fn()} onSubmit={vi.fn(async () => true)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Usar plantilla de brief' }));
    expect((screen.getByLabelText('Brief y notas') as HTMLTextAreaElement).value).toMatch(/^Qué ofrecemos:/);
    expect(screen.queryByRole('button', { name: 'Usar plantilla de brief' })).not.toBeInTheDocument();
  });

  it('no se ofrece en solo lectura', () => {
    render(<CampaignFormDialog open onOpenChange={vi.fn()} onSubmit={vi.fn(async () => true)} readOnly campaign={campaign} />);
    expect(screen.queryByRole('button', { name: 'Usar plantilla de brief' })).not.toBeInTheDocument();
  });
});
