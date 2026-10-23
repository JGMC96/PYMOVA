import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { BusinessSettings } from '@/components/settings/BusinessSettings';
import { RoleSettings } from '@/components/settings/RoleSettings';
import { TeamSettings } from '@/components/settings/TeamSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { SecurityAuditSettings } from '@/components/settings/SecurityAuditSettings';
import { StoreSettings } from '@/components/settings/StoreSettings';
import { IntegrationsIndex } from '@/pages/dashboard/Integrations';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useBusiness } from '@/contexts/BusinessContext';

const Settings = () => {
  const { isAdmin } = useRoleAccess('admin');
  const { enabledModules } = useBusiness();
  const hasStore = enabledModules.includes('retail');
  // La pestaña va en la dirección (?tab=…) para poder enlazarla, p. ej. Integraciones.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'profile';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
          <p className="text-muted-foreground">
            Administra tu perfil, negocio, tienda e integraciones
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(value) => setSearchParams(value === 'profile' ? {} : { tab: value }, { replace: true })}
        className="space-y-6"
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start lg:w-auto lg:inline-flex">
          <TabsTrigger value="profile">Mi Perfil</TabsTrigger>
          <TabsTrigger value="business">Mi Negocio</TabsTrigger>
          {hasStore && <TabsTrigger value="store">Tienda</TabsTrigger>}
          <TabsTrigger value="role">Mi Rol</TabsTrigger>
          <TabsTrigger value="team">Equipo</TabsTrigger>
          <TabsTrigger value="billing">Facturación</TabsTrigger>
          <TabsTrigger value="integrations">Integraciones</TabsTrigger>
          {isAdmin && <TabsTrigger value="audit">Seguridad</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="business" className="mt-6">
          <BusinessSettings />
        </TabsContent>

        {hasStore && (
          <TabsContent value="store" className="mt-6">
            <StoreSettings />
          </TabsContent>
        )}

        <TabsContent value="role" className="mt-6">
          <RoleSettings />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <TeamSettings />
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <BillingSettings />
        </TabsContent>

        <TabsContent value="integrations" className="mt-6">
          <IntegrationsIndex showHeader={false} />
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
