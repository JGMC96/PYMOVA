// Protección contra que otra web meta PYMOVA dentro de la suya (un iframe) para engañar a
// quien la usa y hacerle pulsar botones sin darse cuenta («clickjacking»). El alojamiento no
// deja poner la cabecera X-Frame-Options, así que se hace aquí: en el dominio de producción,
// dentro de un iframe no se pinta la app. El editor de Lovable sí la enseña en su vista previa,
// que va por otros dominios.
export const PRODUCTION_HOSTS = ['pymova.com', 'www.pymova.com'];

export function isFramedOnProduction(win: Pick<Window, 'self' | 'top' | 'location'> = window): boolean {
  let framed: boolean;
  try {
    framed = win.self !== win.top;
  } catch {
    // Leer `top` de otro origen puede lanzar error: eso ya es estar dentro de un iframe.
    framed = true;
  }
  return framed && PRODUCTION_HOSTS.includes(win.location.hostname);
}
