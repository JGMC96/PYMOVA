import { describe, expect, it } from 'vitest';
import {
  codeProblemsCsv, codeRows, findCodeProblems, normalizeCode,
  type CodeProduct, type CodeVariant,
} from '@/lib/codeProblems';

const prod = (id: string, name: string, extra: Partial<CodeProduct> = {}): CodeProduct => ({
  id, name, is_active: true, sku: null, barcode: null, external_source: 'shopify', ...extra,
});
const talla = (id: string, productId: string, name: string, sku: string | null, barcode: string | null, is_active = true): CodeVariant => ({
  id, product_id: productId, name, sku, barcode, is_active,
});

// Como en TUILUS: el patrón de Stockagile pone «000» en el modelo y Bolonia, Cullera y Cannes
// acaban con el mismo SKU en la talla 35.
const productos = [
  prod('bol', 'Zueco Bolonia Piel Negro', { sku: 'TFW23ZU000NE35' }),
  prod('cul', 'Zueco Cullera Piel Negro', { sku: 'TFW23ZU000NE35' }),
  prod('can', 'Botín Cannes Piel Negro', { is_active: false }),
  prod('cal', 'Calcetines Zueco Marrón Rojo'),
  prod('vale', 'Vale regalo', { external_source: null, sku: 'VALE', barcode: '1234' }),
];
const tallas = [
  talla('bol35', 'bol', '35', 'TFW23ZU000NE35', '9600000000901'),
  talla('bol36', 'bol', '36', 'TFW23ZU000NE36', '9600000000902'),
  talla('cul35', 'cul', '35', 'tfw23zu000ne35 ', '9600000001755'),
  talla('can35', 'can', '35', 'TFW23ZU000NE35', '9600000005012'),
  talla('cal1', 'cal', '35-38', null, null),
  talla('cal2', 'cal', '39-44', '', '9600000001755'),
  talla('bol37', 'bol', '37', null, '9600000000903', false),
];

describe('códigos con problemas', () => {
  const rows = codeRows(productos, tallas);

  it('compara los SKU sin mayúsculas ni espacios', () => {
    expect(normalizeCode(' tfw 23ZU ')).toBe('tfw23zu');
    expect(normalizeCode(null)).toBe('');
  });

  it('una fila por talla y una por producto sin tallas; el SKU copiado del producto no cuenta', () => {
    expect(rows.map((r) => r.key)).toEqual(['can35', 'cal1', 'cal2', 'vale', 'bol35', 'bol36', 'bol37', 'cul35']);
    expect(rows.find((r) => r.key === 'vale')).toMatchObject({ size: null, sku: 'VALE', status: 'local_active' });
    expect(rows.find((r) => r.key === 'can35')).toMatchObject({ active: false, status: 'inactive' });
    expect(rows.find((r) => r.key === 'bol37')).toMatchObject({ active: false, status: 'size_removed' });
  });

  it('con todos: SKU repetidos en todo el catálogo, y tallas sin SKU o sin código de barras', () => {
    const r = findCodeProblems(rows, { onlyActive: false });
    expect(r.duplicateSkus).toHaveLength(1);
    expect(r.duplicateSkus[0].code).toBe('TFW23ZU000NE35');
    expect(r.duplicateSkus[0].rows.map((x) => x.key).sort()).toEqual(['bol35', 'can35', 'cul35']);
    expect(r.missingSku.map((x) => x.key)).toEqual(['cal1', 'cal2', 'bol37']);
    expect(r.missingBarcode.map((x) => x.key)).toEqual(['cal1']);
    expect(r.duplicateBarcodes.map((g) => g.rows.map((x) => x.key).sort())).toEqual([['cal2', 'cul35']]);
    expect(r.problems.get('cal1')).toEqual(['missing_sku', 'missing_barcode']);
    expect(r.problems.has('bol36')).toBe(false);
  });

  it('con activos: el grupo se enseña si alguna talla está a la venta, y las tallas sin código solo si se venden', () => {
    const r = findCodeProblems(rows, { onlyActive: true });
    expect(r.duplicateSkus[0].rows).toHaveLength(3);
    expect(r.missingSku.map((x) => x.key)).toEqual(['cal1', 'cal2']);
    // Solo inactivas con el mismo SKU: no se enseña.
    const soloInactivas = codeRows([prod('a', 'A', { is_active: false }), prod('b', 'B', { is_active: false })], [
      talla('a1', 'a', '38', 'X1', '1'), talla('b1', 'b', '38', 'X1', '2'),
    ]);
    expect(findCodeProblems(soloInactivas, { onlyActive: true }).duplicateSkus).toEqual([]);
    expect(findCodeProblems(soloInactivas, { onlyActive: false }).duplicateSkus).toHaveLength(1);
  });

  it('CSV para Stockagile: una fila por talla con sus problemas y con qué está repetida', () => {
    const r = findCodeProblems(rows, { onlyActive: false });
    const lines = codeProblemsCsv(r, rows).split('\r\n');
    expect(lines[0]).toBe('"Producto","Talla","SKU actual","Código de barras","Problema","Repetido en","Estado en Shopify"');
    expect(lines).toHaveLength(1 + 6);
    expect(lines).toContain(
      '"Zueco Bolonia Piel Negro","35","TFW23ZU000NE35","9600000000901","SKU repetido","Botín Cannes Piel Negro · 35 | Zueco Cullera Piel Negro · 35","Activo en Shopify"',
    );
    expect(lines).toContain(
      '"Calcetines Zueco Marrón Rojo","39-44","","9600000001755","Sin SKU · Código de barras repetido","Zueco Cullera Piel Negro · 35","Activo en Shopify"',
    );
    expect(lines.some((l) => l.includes('"36"'))).toBe(false);
  });
});
