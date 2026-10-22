import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch } from '@/lib/search';

describe('buscador de productos', () => {
  it('quita tildes y mayúsculas', () => {
    expect(normalizeSearch('  Sandalia PARÍS ')).toBe('sandalia paris');
    expect(normalizeSearch('Pelo Coñac')).toBe('pelo conac');
  });

  it('encuentra con o sin tilde', () => {
    expect(matchesSearch('paris', ['Sandalia París Gris'])).toBe(true);
    expect(matchesSearch('parís', ['Sandalia París Gris'])).toBe(true);
    expect(matchesSearch('río', ['Zueco Rio Tira Pelo Cow'])).toBe(true);
    expect(matchesSearch('botin', ['Botín Denia Elástico'])).toBe(true);
    expect(matchesSearch('coñac', ['Bolonia Pelo Coñac'])).toBe(true);
  });

  it('cada palabra por separado y en cualquier campo', () => {
    expect(matchesSearch('sandalia gris', ['Sandalia París Gris'])).toBe(true);
    expect(matchesSearch('gris paris', ['Sandalia París Gris'])).toBe(true);
    expect(matchesSearch('zueco tssd25', ['Zueco Rio', null, 'TSSD25ZU001'])).toBe(true);
    expect(matchesSearch('sandalia negro', ['Sandalia París Gris'])).toBe(false);
  });

  it('sin búsqueda, todo vale', () => {
    expect(matchesSearch('  ', ['Lo que sea'])).toBe(true);
  });
});
