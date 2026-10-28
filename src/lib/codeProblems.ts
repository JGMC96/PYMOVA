// Códigos con problemas: SKU repetidos o vacíos y tallas sin código de barras (o con uno
// repetido). Los SKU repetidos hacen que el stock o una venta caigan en la talla equivocada y
// que Google no acepte el producto (sin SKU no hay MPN). Con Stockagile o Shopify conectados
// los códigos se corrigen allí: si se cambian aquí, la siguiente sincronización los pisa. Por
// eso la pantalla solo los enseña y los saca a CSV.
import { csvRow } from './csv';

export type CodeProblem = 'duplicate_sku' | 'missing_sku' | 'missing_barcode' | 'duplicate_barcode';

export const CODE_PROBLEM_LABELS: Record<CodeProblem, string> = {
  duplicate_sku: 'SKU repetido',
  missing_sku: 'Sin SKU',
  missing_barcode: 'Sin código de barras',
  duplicate_barcode: 'Código de barras repetido',
};

export type ShopifyStatus = 'active' | 'inactive' | 'size_removed' | 'local_active' | 'local_inactive';

export const SHOPIFY_STATUS_LABELS: Record<ShopifyStatus, string> = {
  active: 'Activo en Shopify',
  inactive: 'Inactivo en Shopify (borrador o archivado)',
  size_removed: 'Talla borrada en Shopify',
  local_active: 'Solo en PYMOVA (activo)',
  local_inactive: 'Solo en PYMOVA (inactivo)',
};

export interface CodeProduct {
  id: string;
  name: string;
  is_active: boolean;
  sku: string | null;
  barcode: string | null;
  external_source: string | null;
}

export interface CodeVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  is_active: boolean;
}

/** Una talla (o un producto sin tallas) con sus códigos. */
export interface CodeRow {
  key: string;
  productId: string;
  productName: string;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  /** Se vende: producto activo y, si es una talla, talla activa. */
  active: boolean;
  status: ShopifyStatus;
}

export interface CodeGroup {
  /** El código tal como aparece en la primera talla. */
  code: string;
  rows: CodeRow[];
}

export interface CodeProblemsReport {
  duplicateSkus: CodeGroup[];
  duplicateBarcodes: CodeGroup[];
  missingSku: CodeRow[];
  missingBarcode: CodeRow[];
  /** Problemas de cada talla (por `key`), para el CSV. */
  problems: Map<string, CodeProblem[]>;
}

/** Comparación sin mayúsculas ni espacios: «tfw 23zu» y «TFW23ZU» son el mismo SKU. */
export function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function compareRows(a: CodeRow, b: CodeRow): number {
  return collator.compare(a.productName, b.productName) || collator.compare(a.size ?? '', b.size ?? '');
}

function statusFor(product: CodeProduct, variant?: CodeVariant): ShopifyStatus {
  if (product.external_source !== 'shopify') return product.is_active ? 'local_active' : 'local_inactive';
  if (variant && !variant.is_active) return 'size_removed';
  return product.is_active ? 'active' : 'inactive';
}

/**
 * Filas a revisar: una por talla y una por cada producto sin tallas. El SKU del producto con
 * tallas es copia del de su primera talla y no cuenta (saldría siempre repetido).
 */
export function codeRows(products: CodeProduct[], variants: CodeVariant[]): CodeRow[] {
  const byProduct = new Map<string, CodeVariant[]>();
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push(v);
    byProduct.set(v.product_id, list);
  }
  const rows: CodeRow[] = [];
  for (const p of products) {
    const sizes = byProduct.get(p.id) ?? [];
    if (sizes.length === 0) {
      rows.push({
        key: p.id, productId: p.id, productName: p.name, size: null,
        sku: p.sku, barcode: p.barcode, active: p.is_active, status: statusFor(p),
      });
      continue;
    }
    for (const v of sizes) {
      rows.push({
        key: v.id, productId: p.id, productName: p.name, size: v.name,
        sku: v.sku, barcode: v.barcode, active: p.is_active && v.is_active, status: statusFor(p, v),
      });
    }
  }
  return rows.sort(compareRows);
}

function repeated(rows: CodeRow[], code: (r: CodeRow) => string | null): CodeGroup[] {
  const groups = new Map<string, CodeRow[]>();
  for (const r of rows) {
    const key = normalizeCode(code(r));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({ code: (code(list[0]) ?? '').trim(), rows: list }))
    .sort((a, b) => collator.compare(a.code, b.code));
}

/**
 * Busca los problemas. Los repetidos se cuentan en todo el catálogo (una talla inactiva con el
 * mismo SKU también confunde a Stockagile); con `onlyActive` solo se enseñan los grupos que
 * tienen alguna talla a la venta, y las tallas sin código que están a la venta.
 */
export function findCodeProblems(rows: CodeRow[], { onlyActive }: { onlyActive: boolean }): CodeProblemsReport {
  const visible = (list: CodeRow[]) => (onlyActive ? list.filter((r) => r.active) : list);
  const anyVisible = (g: CodeGroup) => !onlyActive || g.rows.some((r) => r.active);

  const duplicateSkus = repeated(rows, (r) => r.sku).filter(anyVisible);
  const duplicateBarcodes = repeated(rows, (r) => r.barcode).filter(anyVisible);
  const missingSku = visible(rows.filter((r) => !normalizeCode(r.sku)));
  const missingBarcode = visible(rows.filter((r) => !normalizeCode(r.barcode)));

  const problems = new Map<string, CodeProblem[]>();
  const add = (r: CodeRow, p: CodeProblem) => problems.set(r.key, [...(problems.get(r.key) ?? []), p]);
  for (const g of duplicateSkus) g.rows.forEach((r) => add(r, 'duplicate_sku'));
  for (const r of missingSku) add(r, 'missing_sku');
  for (const g of duplicateBarcodes) g.rows.forEach((r) => add(r, 'duplicate_barcode'));
  for (const r of missingBarcode) add(r, 'missing_barcode');

  return { duplicateSkus, duplicateBarcodes, missingSku, missingBarcode, problems };
}

/** Tallas distintas afectadas por algún problema. */
export function affectedCount(report: CodeProblemsReport): number {
  return report.problems.size;
}

const rowLabel = (r: CodeRow) => (r.size ? `${r.productName} · ${r.size}` : r.productName);

/**
 * CSV para corregir los códigos en Stockagile (o en Shopify): una fila por talla con todos sus
 * problemas y, si el SKU o el código de barras está repetido, con qué otras tallas.
 */
export function codeProblemsCsv(report: CodeProblemsReport, rows: CodeRow[]): string {
  const sharing = new Map<string, string[]>();
  for (const g of [...report.duplicateSkus, ...report.duplicateBarcodes]) {
    for (const r of g.rows) {
      const others = g.rows.filter((o) => o.key !== r.key).map(rowLabel);
      sharing.set(r.key, [...new Set([...(sharing.get(r.key) ?? []), ...others])]);
    }
  }
  const lines = [csvRow(['Producto', 'Talla', 'SKU actual', 'Código de barras', 'Problema', 'Repetido en', 'Estado en Shopify'])];
  for (const r of rows) {
    const list = report.problems.get(r.key);
    if (!list) continue;
    lines.push(csvRow([
      r.productName,
      r.size ?? '',
      r.sku ?? '',
      r.barcode ?? '',
      list.map((p) => CODE_PROBLEM_LABELS[p]).join(' · '),
      (sharing.get(r.key) ?? []).join(' | '),
      SHOPIFY_STATUS_LABELS[r.status],
    ]));
  }
  return lines.join('\r\n');
}
