import { describe, expect, it } from 'vitest';
import { redactEmail, redactToken } from '../../supabase/functions/_shared/privacy';

describe('redactEmail', () => {
  it('deja la primera letra y el dominio', () => {
    expect(redactEmail('juan.perez@tuilus.com')).toBe('j***@tuilus.com');
  });
  it('no revela nada si el valor no es un correo', () => {
    expect(redactEmail('sin-arroba')).toBe('***');
    expect(redactEmail(null)).toBe('unknown');
    expect(redactEmail('')).toBe('unknown');
  });
});

describe('redactToken', () => {
  it('deja solo un prefijo corto y la longitud', () => {
    expect(redactToken('abcdef0123456789')).toBe('abcd…(16)');
    expect(redactToken(undefined)).toBe('unknown');
  });
});
