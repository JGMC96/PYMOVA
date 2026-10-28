import { describe, expect, it } from 'vitest';
import { campaignsOnDay, campaignTiming, formatGoalValue, goalProgress } from './marketingPlan';
import type { MarketingCampaign } from '@/types/database';

const campana = (name: string, starts_on: string, ends_on: string): MarketingCampaign => ({
  id: name,
  business_id: 'b1',
  name,
  kind: 'campaign',
  starts_on,
  ends_on,
  color: null,
  goal: null,
  notes: null,
  created_at: '2026-10-28T00:00:00Z',
});

describe('plan de marketing', () => {
  it('da las campañas de un día, las más largas primero', () => {
    const lista = [
      campana('Black Friday', '2026-11-27', '2026-11-27'),
      campana('Navidad', '2026-12-01', '2026-12-24'),
      campana('Semana BF', '2026-11-23', '2026-11-30'),
    ];
    expect(campaignsOnDay(lista, '2026-11-27').map((c) => c.name)).toEqual(['Semana BF', 'Black Friday']);
    expect(campaignsOnDay(lista, '2026-11-30').map((c) => c.name)).toEqual(['Semana BF']);
    expect(campaignsOnDay(lista, '2026-12-25')).toEqual([]);
  });

  it('calcula el avance de un objetivo sin pasar de 0 a 100', () => {
    expect(goalProgress({ target: 15000, current: 3750 })).toBe(25);
    expect(goalProgress({ target: 500, current: 800 })).toBe(100);
    expect(goalProgress({ target: 0, current: 10 })).toBe(0);
  });

  it('escribe las ventas en la moneda del negocio y lo demás como número', () => {
    expect(formatGoalValue('sales', 15000, 'EUR')).toMatch(/15\.000,00\s€/);
    expect(formatGoalValue('followers', 1500, 'EUR')).toBe('1500');
    expect(formatGoalValue('reach', 125000, 'EUR')).toBe('125.000');
  });

  it('sabe si una campaña ha pasado, está en curso o está por venir', () => {
    const bf = campana('BF', '2026-11-27', '2026-11-30');
    expect(campaignTiming(bf, '2026-11-01')).toBe('upcoming');
    expect(campaignTiming(bf, '2026-11-30')).toBe('current');
    expect(campaignTiming(bf, '2026-12-01')).toBe('past');
  });
});
