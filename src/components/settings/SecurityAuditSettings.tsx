import { ShieldCheck, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSecurityAuditLog, type SecurityAuditEntry } from '@/hooks/useSecurityAuditLog';
import { useRoleAccess } from '@/hooks/useRoleAccess';

const AREA_LABEL: Record<string, string> = {
  business_members: 'Equipo y permisos',
  business_invitations: 'Invitaciones',
  businesses: 'Datos del negocio',
  business_settings: 'Configuración de facturación',
  shopify_connections: 'Conexión con la tienda online',
  platform_roles: 'Permisos de plataforma',
};

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Alta',
  UPDATE: 'Cambio',
  DELETE: 'Baja',
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'propietario',
  admin: 'administrador',
  staff: 'empleado',
};

function value(data: Record<string, unknown> | null, key: string): string | null {
  const raw = data?.[key];
  if (raw === null || raw === undefined) return null;
  return String(raw);
}

function describe(entry: SecurityAuditEntry): string {
  const before = entry.old_data;
  const after = entry.new_data;

  if (entry.table_name === 'business_members') {
    const role = value(after, 'role') ?? value(before, 'role');
    const oldRole = value(before, 'role');
    if (entry.action === 'INSERT') {
      return `Se añadió una persona al equipo como ${ROLE_LABEL[role ?? ''] ?? role}`;
    }
    if (entry.action === 'DELETE') {
      return 'Se eliminó a una persona del equipo';
    }
    if (oldRole && role && oldRole !== role) {
      return `Cambio de rol: de ${ROLE_LABEL[oldRole] ?? oldRole} a ${ROLE_LABEL[role] ?? role}`;
    }
    const wasActive = value(before, 'is_active');
    const isActive = value(after, 'is_active');
    if (wasActive !== isActive) {
      return isActive === 'true' ? 'Se reactivó el acceso de una persona' : 'Se desactivó el acceso de una persona';
    }
    return 'Cambio en un miembro del equipo';
  }

  if (entry.table_name === 'business_invitations') {
    const email = value(after, 'email') ?? value(before, 'email') ?? 'sin correo';
    const role = value(after, 'role') ?? value(before, 'role') ?? '';
    if (entry.action === 'INSERT') return `Invitación enviada a ${email} como ${ROLE_LABEL[role] ?? role}`;
    if (entry.action === 'DELETE') return `Invitación cancelada (${email})`;
    const status = value(after, 'status');
    return `Invitación de ${email}: ${status ?? 'actualizada'}`;
  }

  if (entry.table_name === 'shopify_connections') {
    if (entry.action === 'INSERT') return 'Se conectó la tienda online';
    if (entry.action === 'DELETE') return 'Se desconectó la tienda online';
    return 'Cambio en la conexión con la tienda online';
  }

  if (entry.table_name === 'business_settings') {
    return 'Cambio en la configuración de facturación';
  }

  if (entry.table_name === 'businesses') {
    return entry.action === 'DELETE' ? 'Se eliminó el negocio' : 'Cambio en los datos del negocio';
  }

  return `${ACTION_LABEL[entry.action] ?? entry.action} en ${entry.table_name}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SecurityAuditSettings() {
  const { isAdmin } = useRoleAccess('admin');
  const { entries, isLoading, hasMore, loadMore, refetch } = useSecurityAuditLog();

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registro de seguridad</CardTitle>
          <CardDescription>
            Solo el propietario y los administradores pueden consultar este registro.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 text-primary" />
          <div>
            <CardTitle>Registro de seguridad</CardTitle>
            <CardDescription>
              Cambios de permisos, invitaciones, propiedad y configuración de este negocio.
            </CardDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && entries.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hay movimientos registrados.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{AREA_LABEL[entry.table_name] ?? entry.table_name}</Badge>
                    <span className="text-sm font-medium">{describe(entry)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.actor_name ?? 'Sistema'} · {ACTION_LABEL[entry.action] ?? entry.action}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <div className="pt-2 text-center">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoading}>
              Ver más
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
