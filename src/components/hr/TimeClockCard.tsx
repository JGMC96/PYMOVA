import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, Coffee, MapPin, Loader2 } from 'lucide-react';
import { useTimeClock } from '@/hooks/useTimeClock';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const STATE_LABEL = {
  out: 'Fuera de servicio',
  working: 'Trabajando',
  on_break: 'En pausa',
} as const;

const STATE_COLOR = {
  out: 'text-muted-foreground',
  working: 'text-emerald-400',
  on_break: 'text-amber-400',
} as const;

export function TimeClockCard() {
  const { state, dashboard, acting, clockIn, breakStart, breakEnd, clockOut } = useTimeClock();
  const [now, setNow] = useState(new Date());
  const reduced = useReducedMotion();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = (() => {
    if (!dashboard?.my_session_clock_in) return '00:00:00';
    const start = new Date(dashboard.my_session_clock_in).getTime();
    const diff = Math.max(0, Math.floor((now.getTime() - start) / 1000));
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  })();

  const stateAnim = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.1 },
      }
    : {
        initial: { opacity: 0, scale: 0.97 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] as const },
      };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-8">
        <div className="flex flex-col items-center text-center gap-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={state} {...stateAnim}>
              <div className={cn('text-sm font-medium uppercase tracking-wide', STATE_COLOR[state])}>
                {STATE_LABEL[state]}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="font-display text-6xl font-bold tabular-nums">
            {format(now, 'HH:mm:ss')}
          </div>
          <div className="text-sm text-muted-foreground capitalize">
            {format(now, "EEEE, d 'de' MMMM yyyy", { locale: es })}
          </div>
          {dashboard?.my_session_clock_in && (
            <div className="text-sm">
              Tiempo en sesión: <span className="font-mono font-semibold">{elapsed}</span>
            </div>
          )}
          {(dashboard?.my_pending_reviews ?? 0) > 0 && (
            <p className="text-xs text-amber-500 max-w-sm">
              {dashboard!.my_pending_reviews === 1
                ? 'Tienes 1 fichaje pendiente de revisión: se quedó abierto más de 12 h. Un administrador lo corregirá.'
                : `Tienes ${dashboard!.my_pending_reviews} fichajes pendientes de revisión: se quedaron abiertos más de 12 h. Un administrador los corregirá.`}
            </p>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={state} {...stateAnim}>
              <div className="flex flex-wrap gap-2 justify-center pt-4">
                {state === 'out' && (
                  <Button size="lg" onClick={clockIn} disabled={acting} className="gap-2">
                    {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Entrada
                  </Button>
                )}
                {state === 'working' && (
                  <>
                    <Button size="lg" variant="outline" onClick={breakStart} disabled={acting} className="gap-2">
                      <Coffee className="w-4 h-4" />
                      Pausa
                    </Button>
                    <Button size="lg" variant="destructive" onClick={clockOut} disabled={acting} className="gap-2">
                      <Square className="w-4 h-4" />
                      Salida
                    </Button>
                  </>
                )}
                {state === 'on_break' && (
                  <Button size="lg" onClick={breakEnd} disabled={acting} className="gap-2">
                    <Pause className="w-4 h-4" />
                    Reanudar
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          <p className="text-xs text-muted-foreground flex items-center gap-1 pt-2">
            <MapPin className="w-3 h-3" />
            Se solicitará tu ubicación al fichar (opcional)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
