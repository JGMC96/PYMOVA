import { useCallback, useEffect, useState } from 'react';
import { monthRange, parseYmd, presetRange, ymd, type FixedPreset, type Preset } from '@/lib/periodos';

/** El día de hoy (AAAA-MM-DD), al día aunque la pantalla pase la noche abierta. */
function useToday() {
  const [today, setToday] = useState(() => ymd(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setToday(ymd(new Date())), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

/** Periodo elegido en un informe (mismo selector en todos). */
export function useInformePeriod(initial: FixedPreset = 'month') {
  const today = useToday();
  const [preset, setPreset] = useState<Preset>(initial);
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [custom, setCustom] = useState(() => presetRange(initial));

  const now = parseYmd(today);
  const range =
    preset === 'custom' ? custom : preset === 'pickMonth' ? monthRange(month, now) : presetRange(preset, now);

  const choosePreset = useCallback(
    (value: Preset) => {
      // Al pasar a fechas libres se parte de las que se estaban viendo.
      if (value === 'custom') setCustom({ from: range.from, to: range.to });
      setPreset(value);
    },
    [range.from, range.to],
  );

  const setFrom = (from: string) => {
    setCustom({ from, to: range.to });
    setPreset('custom');
  };
  const setTo = (to: string) => {
    setCustom({ from: range.from, to });
    setPreset('custom');
  };

  const invalid = !range.from || !range.to || range.from > range.to;
  /** El periodo incluye hoy: las cifras pueden cambiar mientras se miran. */
  const isLive = !invalid && range.from <= today && range.to >= today;

  return {
    preset, month, today, from: range.from, to: range.to, invalid, isLive,
    choosePreset, setMonth, setFrom, setTo,
  };
}
