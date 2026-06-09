import { Badge } from '@/components/ui/badge';
import type { PermissionType } from '@/types/database';

const LABEL: Record<PermissionType, string> = {
  late_arrival: 'Llegada tarde',
  early_departure: 'Salida anticipada',
  personal_errand: 'Gestión personal',
  other: 'Otro',
};

const STYLE: Record<PermissionType, string> = {
  late_arrival: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  early_departure: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  personal_errand: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function PermissionTypeBadge({ type, label }: { type: PermissionType; label?: string | null }) {
  return (
    <Badge variant="outline" className={STYLE[type]}>
      {type === 'other' && label ? label : LABEL[type]}
    </Badge>
  );
}
