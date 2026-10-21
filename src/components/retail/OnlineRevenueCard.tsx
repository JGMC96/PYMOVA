import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { fmt, parseYmd, presetRange, PRESET_LABEL, type Preset } from '@/lib/periodos';

/**
 * Facturación online de un periodo (solo la ve el propietario).
 * Suma el total de los pedidos online no cancelados ni devueltos cuya fecha en PYMOVA
 * está dentro del periodo. Va aparte de la lista de pedidos: no depende del filtro de
 * estado ni del límite de 200 pedidos de la tabla.
 */

const PAGE = 1000;

const currency = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value || 0);

export function OnlineRevenueCard({ refreshKey }: { refreshKey?: unknown }) {
  const { activeBusinessId } = useBusiness();
  const [preset, setPreset] = useState<Preset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [result, setResult] = useState<{ revenue: number; count: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = !from || !to || from > to;

  const choosePreset = (value: Preset) => {
    setPreset(value);
    if (value !== 'custom') {
      const r = presetRange(value);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const load = useCallback(async () => {
    if (!activeBusinessId || invalid) return;
    setIsLoading(true);
    setError(null);
    // [desde 00:00, día siguiente a «hasta» 00:00) en hora local.
    const start = parseYmd(from).toISOString();
    const endDate = parseYmd(to);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).toISOString();

    let revenue = 0;
    let count = 0;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error: err } = await supabase
        .from('online_orders')
        .select('total')
        .eq('business_id', activeBusinessId)
        .not('status', 'in', '(cancelled,returned)')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (err) {
        setError(err.message);
        setIsLoading(false);
        return;
      }
      const rows = data ?? [];
      revenue += rows.reduce((sum, r) => sum + Number(r.total), 0);
      count += rows.length;
      if (rows.length < PAGE) break;
    }
    setResult({ revenue, count });
    setIsLoading(false);
  }, [activeBusinessId, from, to, invalid]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const periodText = useMemo(() => {
    if (invalid) return 'Elige un periodo válido';
    return from === to ? `El ${fmt(from)}` : `Del ${fmt(from)} al ${fmt(to)}`;
  }, [from, to, invalid]);

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Facturación online</p>
          <Select value={preset} onValueChange={(v) => choosePreset(v as Preset)}>
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Periodo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
                <SelectItem key={p} value={p}>{PRESET_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="flex items-center gap-2 text-2xl font-bold">
          {isLoading && !result ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : currency(result?.revenue ?? 0)}
          {isLoading && result && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </p>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="h-8 w-[140px] text-xs"
              aria-label="Desde"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">a</span>
            <Input
              type="date"
              className="h-8 w-[140px] text-xs"
              aria-label="Hasta"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {error
            ? `No se pudo calcular: ${error}`
            : `${periodText}${result && !invalid ? ` · ${result.count} ${result.count === 1 ? 'pedido' : 'pedidos'}` : ''} · sin cancelados ni devueltos`}
        </p>
      </CardContent>
    </Card>
  );
}
