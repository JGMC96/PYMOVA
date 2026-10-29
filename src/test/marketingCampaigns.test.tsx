import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { format } from 'date-fns';
import type { MarketingCampaign, MarketingGoal } from '@/types/database';

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ activeBusiness: { id: 'b1', currency: 'EUR' } }),
}));

import { MarketingCampaigns } from '@/components/marketing/MarketingCampaigns';
import { MarketingCalendar } from '@/components/marketing/MarketingCalendar';

// Fechas relativas a hoy: el panel esconde por defecto lo terminado.
const hoy = new Date();
const dia = (offset: number) => format(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + offset), 'yyyy-MM-dd');

const campana = (name: string, starts_on: string, ends_on: string, kind: MarketingCampaign['kind'] = 'campaign') => ({
  id: name,
  business_id: 'b1',
  name,
  kind,
  starts_on,
  ends_on,
  color: null,
  goal: null,
  notes: null,
  created_at: '2026-10-28T00:00:00Z',
});

const objetivo: MarketingGoal = {
  id: 'g1',
  business_id: 'b1',
  title: 'Ventas Black Friday',
  metric: 'sales',
  target: 15000,
  current: 3750,
  starts_on: dia(0),
  ends_on: dia(10),
  campaign_id: null,
  notes: null,
  created_at: '2026-10-28T00:00:00Z',
};

const props = {
  posts: [],
  onNewCampaign: vi.fn(),
  onSelectCampaign: vi.fn(),
  onAddKeyDates: vi.fn(async () => 3),
  onNewGoal: vi.fn(),
  onSelectGoal: vi.fn(),
};

describe('Campañas y objetivos', () => {
  const campaigns = [campana('Black Friday', dia(5), dia(5), 'key_date'), campana('Verano pasado', dia(-60), dia(-30))];

  it('enseña el avance de los objetivos y esconde lo terminado', () => {
    render(<MarketingCampaigns {...props} campaigns={campaigns} goals={[objetivo]} canEdit />);

    expect(screen.getByText('25%')).toBeInTheDocument();
    // es-ES no agrupa los números de 4 cifras: «3750,00 €».
    expect(screen.getByText(/3\.?750,00\s€/)).toBeInTheDocument();
    expect(screen.getByText('Black Friday')).toBeInTheDocument();
    expect(screen.queryByText('Verano pasado')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText('Verano pasado')).toBeInTheDocument();
  });

  it('el administrador puede añadir fechas clave, campañas y objetivos', () => {
    render(<MarketingCampaigns {...props} campaigns={campaigns} goals={[objetivo]} canEdit />);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fechas clave/ }));
    expect(props.onAddKeyDates).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Nueva campaña/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo objetivo/ })).toBeInTheDocument();
  });

  it('el personal lo ve, pero sin botones para crear', () => {
    render(<MarketingCampaigns {...props} campaigns={campaigns} goals={[objetivo]} canEdit={false} />);

    expect(screen.getByText('Ventas Black Friday')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir fechas clave/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nueva campaña/ })).not.toBeInTheDocument();
  });
});

describe('Calendario con campañas', () => {
  it('pinta la franja de la campaña con su nombre y la abre al pulsarla', () => {
    const onSelectCampaign = vi.fn();
    const bf = campana('Semana fuerte', dia(0), dia(0));
    render(
      <MarketingCalendar
        posts={[]}
        campaigns={[bf]}
        onSelectPost={vi.fn()}
        onSelectCampaign={onSelectCampaign}
        onSelectDay={vi.fn()}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Semana fuerte' }));
    expect(onSelectCampaign).toHaveBeenCalledWith(bf);
  });
});
