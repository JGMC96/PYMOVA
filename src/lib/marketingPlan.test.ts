import { describe, expect, it } from 'vitest';
import {
  campaignsOnDay,
  campaignTiming,
  canToggleTask,
  formatGoalValue,
  goalProgress,
  sortTasks,
  taskState,
} from './marketingPlan';
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

  it('sabe si una tarea está hecha, vencida, es de hoy o está pendiente', () => {
    const hoy = '2026-11-20';
    expect(taskState({ done_at: '2026-11-19T10:00:00Z', due_on: '2026-11-01' }, hoy)).toBe('done');
    expect(taskState({ done_at: null, due_on: '2026-11-19' }, hoy)).toBe('overdue');
    expect(taskState({ done_at: null, due_on: hoy }, hoy)).toBe('today');
    expect(taskState({ done_at: null, due_on: '2026-11-21' }, hoy)).toBe('pending');
    expect(taskState({ done_at: null, due_on: null }, hoy)).toBe('pending');
  });

  it('ordena las tareas: vencidas, de hoy, por fecha, sin fecha y hechas', () => {
    const t = (id: string, due_on: string | null, done_at: string | null = null) => ({
      id,
      due_on,
      done_at,
      created_at: '2026-11-01T00:00:00Z',
    });
    const orden = sortTasks(
      [t('hecha', '2026-11-10', '2026-11-10T09:00:00Z'), t('sin-fecha', null), t('luego', '2026-11-25'),
        t('hoy', '2026-11-20'), t('vencida', '2026-11-18'), t('pronto', '2026-11-22')],
      '2026-11-20',
    ).map((x) => x.id);
    expect(orden).toEqual(['vencida', 'hoy', 'pronto', 'luego', 'sin-fecha', 'hecha']);
  });

  it('una tarea la marca su responsable o un administrador', () => {
    expect(canToggleTask({ assignee_id: 'u1' }, 'u1', false)).toBe(true);
    expect(canToggleTask({ assignee_id: 'u1' }, 'u2', false)).toBe(false);
    expect(canToggleTask({ assignee_id: null }, 'u2', false)).toBe(false);
    expect(canToggleTask({ assignee_id: 'u1' }, 'u2', true)).toBe(true);
  });
});
