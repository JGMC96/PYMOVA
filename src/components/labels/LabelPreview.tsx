import { useMemo } from 'react';
import { labelSizeMm, labelStyles, renderLabelPages, type LabelConfig, type LabelData } from '@/lib/labels';

/** Vista previa de una etiqueta a tamaño real (aprox.), en un iframe para aislar sus estilos. */
export function LabelPreview({ config, data, taxRate }: { config: LabelConfig; data: LabelData; taxRate: number }) {
  const { width, height } = labelSizeMm(config.sheet);
  const html = useMemo(() => {
    const single: LabelConfig = { ...config, sheet: { ...config.sheet, mode: 'roll', rollWidthMm: width, rollHeightMm: height, border: true } };
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${labelStyles(single)} body{padding:4px}</style></head>
      <body>${renderLabelPages(single, [data], taxRate)}</body></html>`;
  }, [config, data, taxRate, width, height]);
  // 1 mm ≈ 3,78 px a 96 ppp.
  return (
    <iframe
      title="Vista previa de la etiqueta"
      srcDoc={html}
      className="rounded border bg-white"
      style={{ width: `calc(${width}mm + 10px)`, height: `calc(${height}mm + 10px)` }}
    />
  );
}
