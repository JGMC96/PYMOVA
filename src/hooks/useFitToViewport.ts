// Alto que le queda a un bloque hasta el final de la ventana, para que la página no haga scroll.
// El TPV lo usa para tener «Cobrar» siempre a la vista: lo que hace scroll es el carrito o el
// recibo, no la página. Solo desde `minWidth`; por debajo devuelve null y el bloque crece.
import { type RefObject, useLayoutEffect, useState } from 'react';

interface FitOptions {
  /** Espacio que hay que dejar debajo del bloque (el relleno de la página). */
  below?: number;
  /** Alto mínimo: en ventanas muy bajas, mejor que la página haga algo de scroll. */
  minHeight?: number;
  /** Ancho desde el que se ajusta (el de `xl` de Tailwind, por ejemplo). */
  minWidth?: number;
}

/** Distancia al principio de la página sin contar transformaciones (la animación de entrada). */
function pageTop(el: HTMLElement): number {
  let top = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
  return top;
}

export function useFitToViewport(
  ref: RefObject<HTMLElement>,
  { below = 0, minHeight = 0, minWidth = 0 }: FitOptions = {},
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => {
      if (!media.matches) setHeight(null);
      else setHeight(Math.max(minHeight, Math.floor(window.innerHeight - pageTop(el) - below)));
    };
    update();
    // Lo de encima puede cambiar de alto (avisos de caja, vendedores conectados…).
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      media.removeEventListener('change', update);
    };
  }, [ref, below, minHeight, minWidth]);

  return height;
}
