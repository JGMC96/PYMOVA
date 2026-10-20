import { describe, expect, it } from 'vitest';
import { buildAdjustReason } from '@/lib/stockAdjust';

describe('buildAdjustReason', () => {
  it('usa el motivo y añade la nota si la hay', () => {
    expect(buildAdjustReason('Recuento', '')).toBe('Recuento');
    expect(buildAdjustReason('Rotura o defecto', ' suela despegada ')).toBe('Rotura o defecto: suela despegada');
  });

  it('«Otro» exige una nota de al menos 3 caracteres', () => {
    expect(buildAdjustReason('Otro', '')).toBeNull();
    expect(buildAdjustReason('Otro', 'ok')).toBeNull();
    expect(buildAdjustReason('Otro', 'Regalo a clienta')).toBe('Regalo a clienta');
  });
});
