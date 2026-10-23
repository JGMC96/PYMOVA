// Configuración › Tienda: el tipo de tienda (tallas, colores… en el TPV) y el diseño del
// ticket. Antes estaban en la cabecera y en la pestaña «Tickets» de Retail.
import { Store } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TicketSettingsPanel } from '@/components/retail/TicketSettingsPanel';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useStoreProfile } from '@/hooks/useStoreProfile';
import { STORE_PROFILE_LIST, type StoreProfile } from '@/lib/storeProfiles';

export function StoreSettings() {
  const { profileKey, profile, updateProfile, isSaving } = useStoreProfile();
  const { isAdmin } = useRoleAccess('admin');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Tipo de tienda
          </CardTitle>
          <CardDescription>
            {profile.description} {!isAdmin && 'Solo propietarios y administradores pueden cambiarlo.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full md:w-64">
            <Select
              value={profileKey}
              onValueChange={(v) => updateProfile(v as StoreProfile)}
              disabled={isSaving || !isAdmin}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tipo de tienda" />
              </SelectTrigger>
              <SelectContent>
                {STORE_PROFILE_LIST.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.emoji} {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <TicketSettingsPanel />
    </div>
  );
}
