// Plantillas de campaña: el brief (en las notas) y la lista de tareas típicas de Black Friday.
import { addDays, format, parseISO } from 'date-fns';
import type { MarketingCampaign, MarketingTask } from '@/types/database';

/** Brief de campaña: se escribe en las notas y cada cual lo rellena a su manera. */
export const CAMPAIGN_BRIEF_TEMPLATE = [
  'Qué ofrecemos: ',
  'Para quién: ',
  'Mensaje principal: ',
  'Productos o colecciones: ',
  'Canales: Instagram, TikTok, Pinterest, email (Klaviyo), tienda',
  'Fechas importantes: ',
  'Quién hace qué: ',
].join('\n');

export interface TaskTemplate {
  title: string;
  notes?: string;
  /** Día de la tarea respecto al inicio o al fin de la campaña (negativo = antes). */
  from: 'start' | 'end';
  offset: number;
}

// Los descuentos se ponen en Shopify con precio de comparación (PR #94): el TPV ya trae el
// precio rebajado, así que no hay que poner el % a mano en la caja.
export const BLACK_FRIDAY_TASKS: TaskTemplate[] = [
  {
    title: 'Decidir el descuento y los productos',
    notes: 'Qué % y en qué productos o colecciones. Apuntarlo en el brief de la campaña.',
    from: 'start',
    offset: -14,
  },
  {
    title: 'Reels y stories de la campaña',
    notes: 'Grabar y programar en Metricool. Apuntar cada pieza como publicación de la campaña en el calendario.',
    from: 'start',
    offset: -7,
  },
  {
    title: 'Revisar el stock de tallas de los productos rebajados',
    from: 'start',
    offset: -7,
  },
  {
    title: 'Emails en Klaviyo: aviso, primer día y último día',
    notes: 'Tres envíos: unos días antes (aviso o acceso anticipado), el primer día y el último día.',
    from: 'start',
    offset: -5,
  },
  {
    title: 'Banner y portada de la web',
    from: 'start',
    offset: -3,
  },
  {
    title: 'Escaparate y cartelería de la tienda',
    from: 'start',
    offset: -3,
  },
  {
    title: 'Avisar al equipo de la tienda: no poner el descuento a mano en el TPV',
    notes: 'El precio ya llega rebajado desde Shopify. Si además se pone el % en la línea, se descuenta dos veces.',
    from: 'start',
    offset: -2,
  },
  {
    title: 'Rebajar los precios en Shopify con precio de comparación',
    notes:
      'En Shopify, poner el precio rebajado y dejar el anterior en «Precio de comparación» (se puede hacer en bloque desde la lista de productos). No hace falta crear un código de descuento para la tienda.',
    from: 'start',
    offset: 0,
  },
  {
    title: 'Comprobar en el TPV que se ve la rebaja',
    notes:
      'Buscar dos o tres productos rebajados en el TPV: tiene que salir el precio anterior tachado y el % (por ejemplo, «179 € → 143,20 € · −20 %»). Si no sale, revisar el precio de comparación en Shopify.',
    from: 'start',
    offset: 0,
  },
  {
    title: 'Quitar la rebaja en Shopify al terminar',
    notes: 'Volver a poner el precio normal y vaciar el precio de comparación.',
    from: 'end',
    offset: 1,
  },
  {
    title: 'Revisar resultados y apuntar lo aprendido',
    notes: 'Ventas, seguidores y emails frente a los objetivos. Apuntarlo en las notas de la campaña para el año que viene.',
    from: 'end',
    offset: 3,
  },
];

const key = (title: string) => title.trim().toLocaleLowerCase('es');

export interface TemplateTaskRow {
  title: string;
  notes: string | null;
  due_on: string;
  campaign_id: string;
}

/**
 * Tareas de la plantilla para una campaña, sin las que ya tiene (mismo título).
 * La fecha sale del inicio o del fin; si ya ha pasado, queda para hoy (salvo que la
 * campaña haya terminado: entonces se deja la suya).
 */
export function buildTemplateTasks(
  campaign: Pick<MarketingCampaign, 'id' | 'starts_on' | 'ends_on'>,
  existing: Pick<MarketingTask, 'title' | 'campaign_id'>[],
  today: string,
  template: TaskTemplate[] = BLACK_FRIDAY_TASKS,
): TemplateTaskRow[] {
  const taken = new Set(existing.filter((t) => t.campaign_id === campaign.id).map((t) => key(t.title)));
  return template
    .filter((t) => !taken.has(key(t.title)))
    .map((t) => {
      const base = t.from === 'start' ? campaign.starts_on : campaign.ends_on;
      let due = format(addDays(parseISO(base), t.offset), 'yyyy-MM-dd');
      if (due < today && today <= campaign.ends_on) due = today;
      return { title: t.title, notes: t.notes ?? null, due_on: due, campaign_id: campaign.id };
    });
}
