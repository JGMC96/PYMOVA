import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeOpenedAt, isOpenFromEarlierDay } from '@/lib/cobro';

/**
 * Aviso de que la caja sigue abierta de un día anterior. No bloquea las ventas:
 * recuerda cerrarla para cuadrar el día. Se revisa cada minuto (por si pasa la medianoche).
 */
export function CashRegisterStaleBanner({
  openedAt,
  onGoToRegister,
}: {
  openedAt: string | null | undefined;
  onGoToRegister?: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!openedAt || !isOpenFromEarlierDay(openedAt, now)) return null;

  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        La caja está abierta desde <strong>{describeOpenedAt(openedAt)}</strong>. Ciérrala para cuadrar
        ese día y abre una nueva para hoy.
      </span>
      {onGoToRegister && (
        <Button size="sm" variant="outline" onClick={onGoToRegister}>
          Ir a cerrar la caja
        </Button>
      )}
    </div>
  );
}
