// Ficha de clienta (0044): tipos de get_client_history y textos para la pantalla.

export interface ClientPurchaseItem {
  name: string;
  quantity: number;
  total: number | null;
}

export interface ClientPurchase {
  /** «stockagile»: ticket de la tienda hecho en Stockagile (0046), solo para consultar. */
  channel: 'store' | 'online' | 'stockagile';
  id: string;
  number: string;
  created_at: string;
  total: number;
  net: number;
  status: string;
  payment_method: string | null;
  items: ClientPurchaseItem[];
}

export interface ClientHistory {
  summary: {
    purchases: number;
    spent: number;
    average: number;
    first_purchase_at: string | null;
    last_purchase_at: string | null;
    store_purchases: number;
    online_purchases: number;
    returned: number;
  };
  sizes: { size: string; units: number }[];
  models: { name: string; units: number }[];
  purchases: ClientPurchase[];
}

export const CHANNEL_LABELS: Record<ClientPurchase['channel'], string> = {
  store: 'Tienda',
  online: 'Web',
  stockagile: 'Tienda (Stockagile)',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  refunded: 'Reembolsado',
};

/** Estado que se enseña (las ventas de tienda sin devolución no llevan etiqueta). */
export function purchaseStatusLabel(p: Pick<ClientPurchase, 'channel' | 'status' | 'net' | 'total'>): string | null {
  if (p.channel === 'store') {
    if (p.status !== 'returned') return null;
    return Number(p.net) > 0 ? 'Devolución parcial' : 'Devuelta';
  }
  if (p.channel === 'stockagile') {
    // En Stockagile la devolución es un ticket aparte, con su importe en negativo.
    if (p.status === 'returned') return 'Devolución';
    if (p.status === 'exchange') return 'Cambio';
    return null;
  }
  return STATUS_LABELS[p.status] ?? p.status;
}

/** ¿La compra no cuenta (cancelada, devuelta o reembolsada entera)? Un ticket de devolución de Stockagile sí cuenta: resta. */
export function isVoidPurchase(p: Pick<ClientPurchase, 'net' | 'channel'>): boolean {
  return p.channel !== 'stockagile' && Number(p.net) <= 0;
}

/** Talla habitual: la más comprada (empates: todas las que empatan). */
export function usualSizes(sizes: ClientHistory['sizes']): string[] {
  if (sizes.length === 0) return [];
  const top = Math.max(...sizes.map((s) => Number(s.units)));
  return sizes.filter((s) => Number(s.units) === top).map((s) => s.size);
}

/** Línea corta del TPV: «3 compras · 369,00 € · talla 38 · última 20 oct 2026». */
export function posClientSummaryText(purchases: number, spent: number, sizes: string[], lastPurchase: string | null): string {
  if (!purchases) return 'Primera compra';
  return [
    `${purchases} ${purchases === 1 ? 'compra' : 'compras'}`,
    eur(spent),
    sizes.length ? `talla ${sizes.join('/')}` : null,
    lastPurchase ? `última ${lastPurchase}` : null,
  ].filter(Boolean).join(' · ');
}

export const eur = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
