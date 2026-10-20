// Envíos a Shopify que no han salido (get_shopify_problems): textos y recuentos para la UI.

export type ShopifyProblemKind = 'venta' | 'devolucion' | 'stock' | 'aviso';
export type ShopifyProblemState = 'failed' | 'retrying' | 'waiting';

export interface ShopifyProblem {
  kind: ShopifyProblemKind;
  state: ShopifyProblemState;
  record_id: string;
  reference: string | null;
  error: string | null;
  attempts: number;
  happened_at: string;
}

export const KIND_LABEL: Record<ShopifyProblemKind, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  stock: 'Stock',
  aviso: 'Aviso de Shopify',
};

export const STATE_LABEL: Record<ShopifyProblemState, string> = {
  failed: 'No se ha enviado',
  retrying: 'Reintentando',
  waiting: 'Esperando a su venta',
};

/** Solo los fallos definitivos piden atención; lo que se está reintentando se avisa aparte. */
export function failedCount(problems: ShopifyProblem[]): number {
  return problems.filter((p) => p.state === 'failed').length;
}

/** Resumen corto para la franja de aviso: «2 ventas y 1 devolución no se han enviado a Shopify». */
export function problemsSummary(problems: ShopifyProblem[]): string | null {
  const failed = problems.filter((p) => p.state === 'failed');
  if (failed.length === 0) return null;
  const count = (k: ShopifyProblemKind) => failed.filter((p) => p.kind === k).length;
  const parts = [
    [count('venta'), 'venta', 'ventas'],
    [count('devolucion'), 'devolución', 'devoluciones'],
    [count('stock'), 'cambio de stock', 'cambios de stock'],
    [count('aviso'), 'aviso de Shopify', 'avisos de Shopify'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${(n as number) === 1 ? one : many}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
  return `${text} ${failed.length === 1 ? 'no se ha procesado' : 'no se han procesado'} en Shopify`;
}
