import { describe, expect, it } from 'vitest';
import { BLACK_FRIDAY_TASKS, buildTemplateTasks, CAMPAIGN_BRIEF_TEMPLATE } from './marketingCampaignKit';

const bf = { id: 'c1', starts_on: '2026-11-27', ends_on: '2026-11-30' };

describe('buildTemplateTasks', () => {
  it('pone las fechas respecto al inicio y al fin de la campaña', () => {
    const rows = buildTemplateTasks(bf, [], '2026-11-01');
    expect(rows).toHaveLength(BLACK_FRIDAY_TASKS.length);
    const due = (t: string) => rows.find((r) => r.title === t)?.due_on;
    expect(due('Decidir el descuento y los productos')).toBe('2026-11-13');
    expect(due('Rebajar los precios en Shopify con precio de comparación')).toBe('2026-11-27');
    expect(due('Quitar la rebaja en Shopify al terminar')).toBe('2026-12-01');
    expect(rows.every((r) => r.campaign_id === 'c1')).toBe(true);
  });

  it('lo que ya ha pasado queda para hoy mientras dura la campaña', () => {
    const rows = buildTemplateTasks(bf, [], '2026-11-20');
    expect(rows.find((r) => r.title === 'Decidir el descuento y los productos')?.due_on).toBe('2026-11-20');
    expect(rows.find((r) => r.title === 'Banner y portada de la web')?.due_on).toBe('2026-11-24');
  });

  it('no repite las tareas que la campaña ya tiene, aunque cambien las mayúsculas', () => {
    const existing = [
      { title: 'banner y portada de la web ', campaign_id: 'c1' },
      { title: 'Escaparate y cartelería de la tienda', campaign_id: 'otra' },
    ];
    const titles = buildTemplateTasks(bf, existing, '2026-11-01').map((r) => r.title);
    expect(titles).not.toContain('Banner y portada de la web');
    expect(titles).toContain('Escaparate y cartelería de la tienda');
    expect(titles).toHaveLength(BLACK_FRIDAY_TASKS.length - 1);
  });

  it('avisa de no poner el descuento a mano en el TPV', () => {
    expect(BLACK_FRIDAY_TASKS.some((t) => /no poner el descuento a mano/i.test(t.title))).toBe(true);
  });
});

describe('CAMPAIGN_BRIEF_TEMPLATE', () => {
  it('cabe en las notas de la campaña (2000 caracteres)', () => {
    expect(CAMPAIGN_BRIEF_TEMPLATE.length).toBeLessThan(2000);
    expect(CAMPAIGN_BRIEF_TEMPLATE).toMatch(/^Qué ofrecemos:/);
  });
});
