// Código de barras Code 128 (juegos B y C) en SVG, sin dependencias.
// Lo leen los lectores de códigos de barras normales (USB o Bluetooth) que
// funcionan como un teclado: escriben el texto y pulsan Intro.

/** Anchos de barra/espacio de cada símbolo (0-105) y del de parada (106). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const CODE_C = 99;
const STOP = 106;

/**
 * Valores Code 128 del texto: inicio B, caracteres, checksum y parada.
 * Si el texto termina en 4 o más dígitos en número par (p. ej. «VTA-000123»),
 * esos dígitos van en el juego C, de dos en dos, para que el código sea más corto.
 */
export function code128Values(text: string): number[] {
  if (!text) throw new Error('Texto vacío');
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Carácter no admitido en Code 128 B: ${JSON.stringify(ch)}`);
  }

  const tail = /(\d+)$/.exec(text)?.[1] ?? '';
  const digitsC = tail.length >= 4 ? tail.slice(tail.length % 2) : '';
  const partB = text.slice(0, text.length - digitsC.length);

  const values = [START_B];
  for (const ch of partB) values.push(ch.charCodeAt(0) - 32);
  if (digitsC) {
    // Si todo son dígitos, el juego B empieza vacío y se pasa a C enseguida.
    values.push(CODE_C);
    for (let i = 0; i < digitsC.length; i += 2) values.push(Number(digitsC.slice(i, i + 2)));
  }

  const checksum = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum, STOP);
  return values;
}

/** Módulos del código: '1' barra, '0' espacio (sin zonas en blanco). */
export function code128Modules(text: string): string {
  return code128Values(text)
    .map((v) =>
      PATTERNS[v]
        .split('')
        .map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(w)))
        .join(''),
    )
    .join('');
}

/** SVG del código con zona en blanco a los lados. El ancho se fija por CSS. */
export function code128Svg(text: string, quietModules = 10): string {
  const modules = code128Modules(text);
  const width = modules.length + quietModules * 2;
  const rects: string[] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let j = i;
      while (j < modules.length && modules[j] === '1') j++;
      rects.push(`<rect x="${i + quietModules}" y="0" width="${j - i}" height="1"/>`);
      i = j;
    } else {
      i++;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 1" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Código de barras ${text.replace(/[<>&"]/g, '')}">` +
    `<rect x="0" y="0" width="${width}" height="1" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`
  );
}
