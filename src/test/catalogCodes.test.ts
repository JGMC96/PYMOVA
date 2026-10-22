import { describe, expect, it } from 'vitest';
import {
  buildSku, colorCode, DEFAULT_SKU_PATTERN, needsCodes, nextModelNumber, planCodes, seasonCode, sizeCode, typeCode,
} from '@/lib/catalogCodes';
import { shopifyCodeConflicts, variantCodeUpdates } from '../../supabase/functions/_shared/catalog-codes';

describe('partes del SKU', () => {
  it('temporada por la fecha', () => {
    expect(seasonCode(new Date(2026, 9, 22))).toBe('FW26');
    expect(seasonCode(new Date(2027, 1, 1))).toBe('SS27');
  });

  it('tipo por el nombre', () => {
    expect(typeCode('Zueco Rio Tira Piel Cuero')).toBe('ZU');
    expect(typeCode('Botín Denia Elástico Serraje Taupe')).toBe('BO');
    expect(typeCode('Sandalia Grecia')).toBe('Sand');
    expect(typeCode('Tarjeta regalo')).toBe('');
  });

  it('siguiente modelo de esa temporada y tipo', () => {
    const skus = ['TFW26ZU003NE38', 'tfw26zu007ca40', 'TFW26BO009NE38', 'TSS26ZU010NE38', null, 'TFW26ZUZV031'];
    expect(nextModelNumber(skus, 'FW26', 'ZU')).toBe('008');
    expect(nextModelNumber(skus, 'FW26', 'BO')).toBe('010');
    expect(nextModelNumber([], 'FW26', 'ZU')).toBe('001');
  });

  it('color con los códigos de Tuilus o dos letras', () => {
    expect(colorCode('Piel Negro')).toBe('NE');
    expect(colorCode('Serraje Visón')).toBe('VIS');
    expect(colorCode('Pelo Coñac')).toBe('CO');
    expect(colorCode('Lila')).toBe('LI');
    expect(colorCode(null)).toBe('');
  });

  it('talla por el atributo o el nombre', () => {
    expect(sizeCode({ name: '38 / Negro', attributes: { Talla: '38' } })).toBe('38');
    expect(sizeCode({ name: '39', attributes: {} })).toBe('39');
  });

  it('arma el SKU con el formato', () => {
    const parts = { temporada: 'FW26', tipo: 'ZU', modelo: '004', color: 'NE', talla: '38' };
    expect(buildSku(DEFAULT_SKU_PATTERN, parts)).toBe('TFW26ZU004NE38');
    expect(buildSku('{TIPO}-{MODELO} {TALLA}', parts)).toBe('ZU-00438');
  });
});

describe('planCodes', () => {
  const variants = [
    { id: 'a', name: '38', attributes: { Talla: '38' }, sku: null, barcode: null },
    { id: 'b', name: '39', attributes: { Talla: '39' }, sku: 'YA-39', barcode: null },
    { id: 'c', name: '40', attributes: { Talla: '40' }, sku: null, barcode: '9600000021121' },
    { id: 'd', name: '41', attributes: { Talla: '41' }, sku: 'X', barcode: '9600000021138' },
    { id: 'e', name: '42', attributes: { Talla: '42' }, sku: null, barcode: null, is_active: false },
  ];
  const options = {
    pattern: DEFAULT_SKU_PATTERN,
    parts: { temporada: 'FW26', tipo: 'ZU', modelo: '004', color: 'NE' },
    withSku: true,
    withBarcode: true,
  };

  it('solo rellena lo que falta y nunca toca lo que existe', () => {
    const plan = planCodes(variants, options, []);
    expect(plan.map((p) => [p.variant.id, p.sku, p.barcode, p.problem])).toEqual([
      ['a', 'TFW26ZU004NE38', 'auto', null],
      ['b', null, 'auto', null],
      ['c', 'TFW26ZU004NE40', null, null],
    ]);
    expect(planCodes(variants, { ...options, withBarcode: false }, []).map((p) => p.variant.id)).toEqual(['a', 'c']);
  });

  it('marca los SKU repetidos', () => {
    const plan = planCodes(variants, options, ['tfw26zu004ne40']);
    expect(plan.find((p) => p.variant.id === 'c')?.problem).toBe('SKU repetido');
    const dobles = planCodes(
      [variants[0], { ...variants[0], id: 'z' }], options, [],
    );
    expect(dobles.map((p) => p.problem)).toEqual([null, 'SKU repetido']);
  });

  it('sabe si a un producto le faltan códigos', () => {
    expect(needsCodes(variants)).toBe(true);
    expect(needsCodes([variants[3], variants[4]])).toBe(false);
  });
});

describe('códigos en Shopify', () => {
  it('no pisa lo que Shopify ya tiene', () => {
    const conflicts = shopifyCodeConflicts(
      [
        { variant_id: 'a', external_id: 'gid://1', sku: 'S1', barcode: 'auto' },
        { variant_id: 'b', external_id: 'gid://2', sku: null, barcode: 'auto' },
        { variant_id: 'c', external_id: 'gid://3', sku: 'S3', barcode: null },
      ],
      [
        { id: 'gid://1', sku: '', barcode: null },
        { id: 'gid://2', sku: 'OTRO', barcode: '2000000000015' },
        { id: 'gid://3', sku: null, barcode: '2000000000022' },
      ],
    );
    expect(conflicts).toEqual(['b']);
  });

  it('manda solo los campos que se rellenan', () => {
    expect(variantCodeUpdates([
      { variant_id: 'a', variant_external_id: 'gid://1', product_external_id: 'gid://p', sku: 'S1', barcode: '9600000021138' },
      { variant_id: 'b', variant_external_id: 'gid://2', product_external_id: 'gid://p', sku: null, barcode: '9600000021145' },
      { variant_id: 'c', variant_external_id: null, product_external_id: null, sku: 'S3', barcode: null },
    ])).toEqual([
      { id: 'gid://1', barcode: '9600000021138', inventoryItem: { sku: 'S1' } },
      { id: 'gid://2', barcode: '9600000021145' },
    ]);
  });
});
