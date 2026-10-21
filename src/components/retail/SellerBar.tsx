import { useEffect, useState } from 'react';
import { Clock, KeyRound, LogOut, UserRound, UserRoundPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSellerSession } from '@/contexts/SellerSessionContext';
import { minutesLeft, SELLER_SESSION_HOURS } from '@/lib/sellerSession';

const remaining = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Franja del TPV con las personas conectadas, alta con PIN, cambio de PIN y fichaje. */
export function SellerBar() {
  const { sellers, elsewhere, requiresSeller, employees, openLogin, openChangePin, disconnect, disconnectAll, clock } = useSellerSession();
  const [clocking, setClocking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Sin dependientes con PIN no hay nada que elegir: la venta queda a nombre de la cuenta.
  if (!requiresSeller && employees.length === 0) return null;

  const fichar = async (type: 'clock_in' | 'clock_out') => {
    setClocking(true);
    const r = await clock(type);
    setClocking(false);
    if (!r) return;
    if (r.error) toast.error(r.error);
    else toast.success(`${type === 'clock_in' ? 'Entrada' : 'Salida'} fichada${r.name ? `: ${r.name}` : ''}`);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm">
      <UserRound className="w-4 h-4 text-primary shrink-0" />
      {sellers.length === 0 ? (
        <span className={requiresSeller ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
          {requiresSeller
            ? `Nadie conectado en este TPV: al cobrar se pedirá el PIN (vale ${SELLER_SESSION_HOURS} horas).`
            : 'Sin dependientes con PIN.'}
        </span>
      ) : (
        <>
          <span className="text-muted-foreground">En este TPV:</span>
          {sellers.map((s) => (
            <Badge key={s.sessionId} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm font-normal">
              <span title={`Le quedan ${remaining(minutesLeft(s, now))}`}>{s.name}</span>
              <button
                type="button"
                onClick={() => void disconnect(s.employeeId)}
                className="rounded p-0.5 hover:bg-background"
                aria-label={`Desconectar a ${s.name}`}
                title="Salir"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Badge>
          ))}
        </>
      )}
      {elsewhere.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5" title="Conectados en otro dispositivo. Para vender a su nombre aquí, tienen que meter su PIN en este TPV.">
          <span className="text-muted-foreground">En otros dispositivos:</span>
          {elsewhere.map((s) => (
            <Badge key={s.employeeId} variant="outline" className="py-1 text-sm font-normal">
              {s.name}
            </Badge>
          ))}
        </span>
      )}
      <span className="flex-1" />
      {requiresSeller && (
        <>
          <Button type="button" variant="outline" size="sm" onClick={openLogin}>
            <UserRoundPlus className="w-4 h-4 mr-1.5" />
            Conectarse
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fichar('clock_in')} disabled={clocking}>
            <Clock className="w-4 h-4 mr-1.5" />
            Entrada
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fichar('clock_out')} disabled={clocking}>
            <Clock className="w-4 h-4 mr-1.5" />
            Salida
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={openChangePin}>
            <KeyRound className="w-4 h-4 mr-1.5" />
            Cambiar mi PIN
          </Button>
        </>
      )}
      {sellers.length > 1 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => void disconnectAll()}>
          <LogOut className="w-4 h-4 mr-1.5" />
          Salir todos
        </Button>
      )}
    </div>
  );
}
