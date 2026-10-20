import { Shield, Crown, UserCog, User } from 'lucide-react';
import { useBusiness } from '@/contexts/BusinessContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AppRole } from '@/types/database';

const ROLE_INFO: Record<AppRole, {
  label: string;
  icon: React.ElementType;
  color: string;
  permissions: string[];
}> = {
  owner: {
    label: 'Propietario',
    icon: Crown,
    color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    permissions: [
      'Control total del negocio',
      'Gestionar suscripción y facturación',
      'Eliminar el negocio',
      'Gestionar miembros del equipo',
      'Configurar todos los ajustes',
      'Acceso a todos los módulos',
    ],
  },
  admin: {
    label: 'Administrador',
    icon: UserCog,
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    permissions: [
      'Gestionar e invitar al personal (no a otros administradores)',
      'Configurar ajustes del negocio',
      'Clientes, facturas y cobros',
      'Productos, precios, costes y stock (salvo que el propietario lo limite)',
      'Panel de inicio, fichajes y ausencias del equipo',
      'Acceso a todos los módulos habilitados',
    ],
  },
  staff: {
    label: 'Personal',
    icon: User,
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
    permissions: [
      'Vender y devolver en el TPV (con los permisos que le dé el propietario)',
      'Consultar productos, stock y clientes',
      'Fichar y pedir ausencias y permisos',
      'Productos, precios, costes o stock solo si el propietario se lo permite',
    ],
  },
};

export function RoleSettings() {
  const { userRole, activeBusiness } = useBusiness();

  if (!userRole || !activeBusiness) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">No se encontró información del rol</p>
        </CardContent>
      </Card>
    );
  }

  const roleInfo = ROLE_INFO[userRole];
  const RoleIcon = roleInfo.icon;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Mi Rol
        </CardTitle>
        <CardDescription>
          Tu rol y permisos en {activeBusiness.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Role Badge */}
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-full ${roleInfo.color}`}>
            <RoleIcon className="h-8 w-8" />
          </div>
          <div>
            <Badge variant="outline" className={`text-base px-3 py-1 ${roleInfo.color}`}>
              {roleInfo.label}
            </Badge>
            <p className="mt-1 text-sm text-muted-foreground">
              Negocio: {activeBusiness.name}
            </p>
          </div>
        </div>

        {/* Permissions List */}
        <div>
          <h4 className="text-sm font-medium mb-3">Permisos de tu rol</h4>
          <ul className="space-y-2">
            {roleInfo.permissions.map((permission, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">✓</span>
                <span className="text-muted-foreground">{permission}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Info Note */}
        <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
          <p>
            Los roles son asignados por el propietario o administradores del negocio.
            Si necesitas cambiar tu rol, contacta a un administrador.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
