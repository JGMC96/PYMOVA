import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_CONFIG, expandLabels, fieldText, labelDataFor, labelSizeMm, newField, normalizeLabelConfig, renderLabel, renderLabelPages,
  type LabelData,
} from '@/lib/labels';

const zueco: LabelData = {
  name: 'Zueco Bolonia Piel Negro', color: 'Piel Negro', size: '38', price: 89, sku: 'TFW23ZU000NE38', barcode: '4006381333931',
};

describe('etiquetas', () => {
  it('el diseño por defecto es el «Etiquetas OK» de Stockagile: A4, 3 × 8 de 70 × 37,13 mm', () => {
    expect(labelSizeMm(DEFAULT_LABEL_CONFIG.sheet)).toEqual({ width: 70, height: 37.13 });
    expect(DEFAULT_LABEL_CONFIG.fields.map((f) => f.kind)).toEqual(['name', 'color', 'size', 'price', 'barcode']);
    expect(labelSizeMm({ ...DEFAULT_LABEL_CONFIG.sheet, mode: 'roll', rollWidthMm: 50, rollHeightMm: 30 })).toEqual({ width: 50, height: 30 });
    expect(labelSizeMm({ ...DEFAULT_LABEL_CONFIG.sheet, orientation: 'landscape', rows: 5, cols: 4, pageMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 } }))
      .toEqual({ width: 71.75, height: 40 });
  });

  it('cada campo con su texto delante; precio con o sin IVA; vacío si falta el dato', () => {
    const [name, color, size, price] = DEFAULT_LABEL_CONFIG.fields;
    expect(fieldText(name, zueco, 21)).toBe('Zueco Bolonia Piel Negro');
    expect(fieldText(color, zueco, 21)).toBe('Piel Negro');
    expect(fieldText(size, zueco, 21)).toBe('Talla 38');
    expect(fieldText(price, zueco, 21)).toBe('Precio 89,00 €');
    expect(fieldText({ ...price, priceWithoutTax: true }, zueco, 21)).toBe('Precio 73,55 €');
    expect(fieldText(color, { ...zueco, color: null }, 21)).toBe('');
    expect(fieldText(newField('text', { text: 'Hecho a mano' }), zueco, 21)).toBe('Hecho a mano');
  });

  it('pinta EAN-13 si el código lo es y Code 128 si no; sin código, sin barras', () => {
    const ean = renderLabel(DEFAULT_LABEL_CONFIG, zueco, 21);
    expect(ean).toContain('aria-label="Código de barras 4006381333931"');
    expect(ean).toContain('Talla 38');
    expect(ean).toContain('<div class="bn">4006381333931</div>');
    const otro = renderLabel(DEFAULT_LABEL_CONFIG, { ...zueco, barcode: 'ABC-12' }, 21);
    expect(otro).toContain('aria-label="Código de barras ABC-12"');
    const sin = renderLabel(DEFAULT_LABEL_CONFIG, { ...zueco, barcode: null }, 21);
    expect(sin).not.toContain('<svg');
    // El texto se escapa.
    expect(renderLabel(DEFAULT_LABEL_CONFIG, { ...zueco, name: '<b>X</b>' }, 21)).toContain('&lt;b&gt;X&lt;/b&gt;');
  });

  it('reparte por páginas con huecos al principio y una por página en rollo', () => {
    const labels = expandLabels([{ data: zueco, quantity: 2 }, { data: { ...zueco, size: '39' }, quantity: 1 }], 23);
    expect(labels.length).toBe(25);
    expect(labels.slice(0, 22).every((l) => l === null)).toBe(true);
    const html = renderLabelPages(DEFAULT_LABEL_CONFIG, labels, 21);
    expect(html.match(/class="page"/g)).toHaveLength(2);
    const rollo = renderLabelPages({ ...DEFAULT_LABEL_CONFIG, sheet: { ...DEFAULT_LABEL_CONFIG.sheet, mode: 'roll' } }, expandLabels([{ data: zueco, quantity: 3 }]), 21);
    expect(rollo.match(/class="page"/g)).toHaveLength(3);
  });

  it('completa una configuración guardada incompleta con el diseño por defecto', () => {
    const c = normalizeLabelConfig({ sheet: { rows: 0, cols: 99, mode: 'sheet' } });
    expect(c.sheet.rows).toBe(1);
    expect(c.sheet.cols).toBe(10);
    expect(c.fields.map((f) => f.kind)).toEqual(DEFAULT_LABEL_CONFIG.fields.map((f) => f.kind));
    expect(normalizeLabelConfig(null).sheet.paddingMm).toBe(3);
  });
});

describe('datos de la etiqueta', () => {
  it('toma talla y color de la talla, y si no, del producto', () => {
    const p = { name: 'Zueco Rio Tira Pelo Cow', color: 'Pelo Cow', price: 139, sku: null, barcode: null };
    expect(labelDataFor(p, { name: '38', attributes: { Talla: '38' }, price: null, sku: 'SKU38', barcode: '4006381333931' })).toEqual({
      name: 'Zueco Rio Tira Pelo Cow', color: 'Pelo Cow', size: '38', price: 139, sku: 'SKU38', barcode: '4006381333931',
    });
    expect(labelDataFor(p, { name: 'M', attributes: { Color: 'Azul' }, price: 6, sku: null, barcode: null })).toMatchObject({ color: 'Azul', size: 'M', price: 6 });
    expect(labelDataFor({ ...p, sku: 'P1', barcode: 'B1' })).toMatchObject({ size: null, sku: 'P1', barcode: 'B1' });
  });
});
