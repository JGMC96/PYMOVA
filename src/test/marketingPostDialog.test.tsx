import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PostFormDialog } from '@/components/marketing/PostFormDialog';
import type { MarketingPost } from '@/types/database';

// jsdom no trae ResizeObserver y las casillas de Radix lo usan.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const post: MarketingPost = {
  id: 'p1',
  business_id: 'b1',
  title: 'Reel zuecos de otoño',
  copy: 'Texto del reel',
  content_type: 'reel',
  channels: ['instagram', 'tiktok'],
  status: 'draft',
  scheduled_at: '2026-11-03T09:00:00.000Z',
  assignee_id: null,
  reference_url: 'https://drive.google.com/carpeta',
  hashtags: '#tuilus',
  notes: 'Grabar en la tienda',
  campaign_id: null,
  created_by: 'u1',
  created_at: '2026-10-28T10:00:00.000Z',
  updated_at: '2026-10-28T10:00:00.000Z',
};

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  teamMembers: [],
  onSubmit: vi.fn(async () => true),
  isSubmitting: false,
};

describe('Ficha de publicación de marketing', () => {
  it('el personal la ve entera, sin poder cambiarla', () => {
    render(<PostFormDialog {...baseProps} post={post} readOnly />);

    expect(screen.getByRole('heading', { name: 'Publicación' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Reel zuecos de otoño')).toBeDisabled();
    expect(screen.getByDisplayValue('Grabar en la tienda')).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Abrir enlace' })).toHaveAttribute(
      'href',
      'https://drive.google.com/carpeta'
    );
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  it('un administrador la puede editar y borrar', () => {
    render(<PostFormDialog {...baseProps} post={post} onDelete={vi.fn(async () => true)} />);

    expect(screen.getByRole('heading', { name: 'Editar publicación' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Reel zuecos de otoño')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
  });

  it('ofrece Instagram, TikTok, Pinterest y Facebook como canales', () => {
    render(<PostFormDialog {...baseProps} post={post} />);

    for (const red of ['Instagram', 'TikTok', 'Pinterest', 'Facebook']) {
      expect(screen.getByText(red)).toBeInTheDocument();
    }
  });

  it('al crear desde un día del calendario propone las 10:00', () => {
    render(<PostFormDialog {...baseProps} defaultDate={new Date(2026, 10, 27)} />);

    expect(screen.getByDisplayValue('2026-11-27T10:00')).toBeInTheDocument();
  });
});
