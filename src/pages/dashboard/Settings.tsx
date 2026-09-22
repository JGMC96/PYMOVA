import { Settings as SettingsIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { BusinessSettings } from '@/components/settings/BusinessSettings';
import { RoleSettings } from '@/components/settings/RoleSettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { SecurityAuditSettings } from '@/components/settings/SecurityAuditSettings';
import { useRoleAccess } from '@/hooks/useRoleAccess';

const Settings = () => {
  const { isAdmin } = useRoleAccess('admin');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
          <p className="text-muted-foreground">
            Administra tu perfil, negocio y preferencias de facturación
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList
          className={`grid w-full grid-cols-2 lg:w-auto lg:inline-grid ${
            isAdmin ? 'sm:grid-cols-6' : 'sm:grid-cols-5'
          }`}
        >
          <TabsTrigger value="profile">Mi Perfil</TabsTrigger>
          <TabsTrigger value="business">Mi Negocio</TabsTrigger>
          <TabsTrigger value="role">Mi Rol</TabsTrigger>
          <TabsTrigger value="team">Equipo</TabsTrigger>
          <TabsTrigger value="billing">Facturación</TabsTrigger>
          {isAdmin && <TabsTrigger value="audit">Seguridad</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="business" className="mt-6">
          <BusinessSettings />
        </TabsContent>

        <TabsContent value="role" className="mt-6">
          <RoleSettings />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <TeamSettings />
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <BillingSettings />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="audit" className="mt-6">
            <SecurityAuditSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default Settings;
