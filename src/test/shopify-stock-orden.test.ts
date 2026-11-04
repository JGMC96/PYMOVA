import { describe, expect, it } from 'vitest';
import { PUSH_LEASE_MS, pushesStillOwed, pushInFlight } from '../../supabase/functions/_shared/shopify-core';

// Con Stockagile conectado, primero el envío de stock a Shopify y después el pedido o el
// movimiento: Stockagile copia su cifra y, si el envío llega detrás, se aplica dos veces
// (VTA-000026: Stockagile 13→12 a las 13:26 y PYMOVA 12→11 a las 13:30).
describe('primero Shopify, después Stockagile', () => {
  it('frenan los envíos pendientes y los fallidos', () => {
    const debe = pushesStillOwed([
      { source_id: 'a', status: 'pending' },
      { source_id: 'b', status: 'failed' },
    ]);
    expect([...debe].sort()).toEqual(['a', 'b']);
  });

  it('no frenan los ya enviados ni los que no se pueden enviar', () => {
    expect(pushesStillOwed([
      { source_id: 'a', status: 'done' },
      { source_id: 'b', status: 'skipped' },
      { source_id: null, status: 'pending' },
    ]).size).toBe(0);
    expect(pushesStillOwed([]).size).toBe(0);
  });

  it('un artículo con varios envíos frena si le queda alguno', () => {
    expect(pushesStillOwed([
      { source_id: 'a', status: 'done' },
      { source_id: 'a', status: 'pending' },
    ]).has('a')).toBe(true);
  });
});

describe('dos ejecuciones no envían lo mismo a la vez', () => {
  const ahora = Date.parse('2026-11-04T10:00:00Z');
  const hace = (ms: number) => new Date(ahora - ms).toISOString();

  it('un envío sin intentos se puede reclamar', () => {
    expect(pushInFlight({ attempts: 0, updated_at: hace(0) }, ahora)).toBe(false);
  });

  it('uno reclamado hace poco está en curso', () => {
    expect(pushInFlight({ attempts: 1, updated_at: hace(1000) }, ahora)).toBe(true);
  });

  it('uno que se cortó se puede reintentar pasado el plazo', () => {
    expect(pushInFlight({ attempts: 1, updated_at: hace(PUSH_LEASE_MS) }, ahora)).toBe(false);
  });
});
