// Código de barras EAN-13 (el de los productos de Tuilus) para las etiquetas.
// 95 módulos: guarda, 6 dígitos (juegos L/G según el primero), guarda central, 6 dígitos (R), guarda.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// Juego (L o G) de cada uno de los 6 primeros dígitos según el primer dígito del código.
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito de control de los 12 primeros dígitos. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** ¿Es un EAN-13 con su dígito de control correcto? */
export function isValidEan13(code: string | null | undefined): code is string {
  return !!code && /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Los 95 módulos del código (1 = barra). */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error(`EAN-13 no válido: ${code}`);
  const parity = PARITY[Number(code[0])];
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? L : G)[Number(code[i])];
  out += '01010';
  for (let i = 7; i <= 12; i++) out += R[Number(code[i])];
  return out + '101';
}

/** SVG del código (sin números; las etiquetas los pintan aparte). El tamaño se fija por CSS. */
export function ean13Svg(code: string, quietModules = 9): string {
  const modules = ean13Modules(code);
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
    `shape-rendering="crispEdges" role="img" aria-label="Código de barras ${code}">` +
    `<rect x="0" y="0" width="${width}" height="1" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`
  );
}
