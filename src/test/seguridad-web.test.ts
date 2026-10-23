import { describe, expect, it } from 'vitest';
import { isFramedOnProduction } from '@/lib/framing';
import { cleanTotpCode, mfaErrorMessage } from '@/lib/mfa';

const ventana = (hostname: string, framed: boolean | 'cross-origin') => {
  const self = {};
  return {
    self,
    get top() {
      if (framed === 'cross-origin') throw new Error('SecurityError');
      return framed ? {} : self;
    },
    location: { hostname },
  } as unknown as Pick<Window, 'self' | 'top' | 'location'>;
};

describe('PYMOVA dentro de otra web', () => {
  it('en producción, dentro de un iframe no se pinta', () => {
    expect(isFramedOnProduction(ventana('pymova.com', true))).toBe(true);
    expect(isFramedOnProduction(ventana('www.pymova.com', 'cross-origin'))).toBe(true);
  });

  it('fuera de un iframe, o en la vista previa de Lovable, sí', () => {
    expect(isFramedOnProduction(ventana('pymova.com', false))).toBe(false);
    expect(isFramedOnProduction(ventana('id-preview--abc.lovable.app', true))).toBe(false);
    expect(isFramedOnProduction(ventana('localhost', true))).toBe(false);
  });
});

describe('verificación en dos pasos', () => {
  it('el código se queda en 6 cifras', () => {
    expect(cleanTotpCode('12 34-56789')).toBe('123456');
    expect(cleanTotpCode('abc')).toBe('');
  });

  it('los errores de Supabase salen en castellano', () => {
    expect(mfaErrorMessage('Invalid TOTP code entered')).toMatch(/no es correcto/);
    expect(mfaErrorMessage('Too many requests')).toMatch(/Demasiados intentos/);
    expect(mfaErrorMessage(undefined)).toBe('No se pudo comprobar el código.');
  });
});
