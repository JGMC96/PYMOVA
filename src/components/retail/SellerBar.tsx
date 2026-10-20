import { useState } from 'react';
import { Clock, Lock, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { IDLE_LOCK_MINUTES } from '@/lib/sellerSession';

/** Franja «Atiende: …» del TPV, con cambio de dependiente, bloqueo y fichaje. */
export function SellerBar() {
  const { seller, requiresSeller, employees, setPinDialogOpen, end, clock } = useSellerSession();
  const [clocking, setClocking] = useState(false);

  // Sin dependientes con PIN no hay nada que elegir: la venta queda a nombre de la cuenta.
  if (!requiresSeller && employees.length === 0) return null;

  const fichar = async (type: 'clock_in' | 'clock_out') => {
    setClocking(true);
    const error = await clock(type);
    setClocking(false);
    if (error) toast.error(error);
    else toast.success(type === 'clock_in' ? 'Entrada fichada' : 'Salida fichada');
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm">
      <UserRound className="w-4 h-4 text-primary shrink-0" />
      {seller ? (
        <span>
          Atiende: <strong>{seller.name}</strong>
        </span>
      ) : requiresSeller ? (
        <span className="text-amber-600 dark:text-amber-400">Nadie se ha identificado todavía.</span>
      ) : (
        <span className="text-muted-foreground">Sin dependiente identificado.</span>
      )}
      <span className="flex-1" />
      {requiresSeller && (
        <Button type="button" variant="outline" size="sm" onClick={() => setPinDialogOpen(true)}>
          <Users className="w-4 h-4 mr-1.5" />
          {seller ? 'Cambiar' : 'Identificarse'}
        </Button>
      )}
      {seller && (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => fichar('clock_in')} disabled={clocking}>
            <Clock className="w-4 h-4 mr-1.5" />
            Entrada
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fichar('clock_out')} disabled={clocking}>
            <Clock className="w-4 h-4 mr-1.5" />
            Salida
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void end()}
            title={`Se bloquea solo tras ${IDLE_LOCK_MINUTES} minutos sin uso`}
          >
            <Lock className="w-4 h-4 mr-1.5" />
            Bloquear
          </Button>
        </>
      )}
    </div>
  );
}
