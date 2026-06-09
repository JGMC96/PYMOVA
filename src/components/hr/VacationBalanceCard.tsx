import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Palmtree } from 'lucide-react';
import type { HrDashboard } from '@/types/database';

export function VacationBalanceCard({ dashboard }: { dashboard: HrDashboard | null }) {
  const total = dashboard?.vacation_days_total ?? 0;
  const used = dashboard?.vacation_days_used ?? 0;
  const pending = dashboard?.vacation_days_pending ?? 0;
  const available = Math.max(0, total - used - pending);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Palmtree className="w-4 h-4 text-primary" />
          Vacaciones {new Date().getFullYear()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{available}</span>
          <span className="text-sm text-muted-foreground">/ {total} días disponibles</span>
        </div>
        <Progress value={pct} />
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Usados</div>
            <div className="font-semibold">{used}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Pendientes</div>
            <div className="font-semibold text-amber-400">{pending}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Disponibles</div>
            <div className="font-semibold text-emerald-400">{available}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
