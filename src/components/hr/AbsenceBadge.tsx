import { Badge } from '@/components/ui/badge';
import type { AbsenceStatus, AbsenceType } from '@/types/database';

const TYPE_LABEL: Record<AbsenceType, string> = {
  vacation: 'Vacaciones',
  sick_leave: 'Baja médica',
  personal: 'Asuntos propios',
  other: 'Otro',
};

const TYPE_STYLE: Record<AbsenceType, string> = {
  vacation: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  sick_leave: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  personal: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

const STATUS_LABEL: Record<AbsenceStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

const STATUS_STYLE: Record<AbsenceStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  cancelled: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function AbsenceTypeBadge({ type, label }: { type: AbsenceType; label?: string | null }) {
  return (
    <Badge variant="outline" className={TYPE_STYLE[type]}>
      {type === 'other' && label ? label : TYPE_LABEL[type]}
    </Badge>
  );
}

export function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
