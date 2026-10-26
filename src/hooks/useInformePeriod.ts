import { useCallback, useState } from 'react';
import { presetRange, type Preset } from '@/lib/periodos';

/** Periodo elegido en un informe (mismo selector en todos). */
export function useInformePeriod(initial: Exclude<Preset, 'custom'> = 'month') {
  const [preset, setPreset] = useState<Preset>(initial);
  const [range, setRange] = useState(() => presetRange(initial));

  const choosePreset = useCallback((value: Preset) => {
    setPreset(value);
    if (value !== 'custom') setRange(presetRange(value));
  }, []);

  const setFrom = useCallback((from: string) => {
    setPreset('custom');
    setRange((r) => ({ ...r, from }));
  }, []);
  const setTo = useCallback((to: string) => {
    setPreset('custom');
    setRange((r) => ({ ...r, to }));
  }, []);

  const invalid = !range.from || !range.to || range.from > range.to;

  return { preset, from: range.from, to: range.to, invalid, choosePreset, setFrom, setTo };
}
