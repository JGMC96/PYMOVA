import { ShoppingCart, Receipt, Package, Wallet } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RequireModule } from '@/components/auth/RequireModule';
import { POSPanel } from '@/components/retail/POSPanel';
import { SalesHistory } from '@/components/retail/SalesHistory';
import { InventoryView } from '@/components/retail/InventoryView';
import { CashRegisterPanel } from '@/components/retail/CashRegisterPanel';
import { useStoreProfile } from '@/hooks/useStoreProfile';
import { STORE_PROFILE_LIST, type StoreProfile } from '@/lib/storeProfiles';

const Retail = () => {
  const { profileKey, profile, updateProfile, isSaving } = useStoreProfile();

  return (
    <RequireModule module="retail">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">
              Retail / Punto de Venta
            </h1>
            <p className="text-muted-foreground mt-1">{profile.description}</p>
          </div>

          <div className="w-full md:w-64">
            <Select
              value={profileKey}
              onValueChange={(v) => updateProfile(v as StoreProfile)}
              disabled={isSaving}
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
        </div>

        <Tabs defaultValue="pos" className="w-full">
          <TabsList>
            <TabsTrigger value="pos" className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Nueva Venta
            </TabsTrigger>
            <TabsTrigger value="register" className="flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Caja
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Historial
            </TabsTrigger>
            <TabsTrigger value="inventory" className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              Inventario
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos" className="mt-6">
            <POSPanel />
          </TabsContent>

          <TabsContent value="register" className="mt-6">
            <CashRegisterPanel />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <SalesHistory />
          </TabsContent>

          <TabsContent value="inventory" className="mt-6">
            <InventoryView />
          </TabsContent>
        </Tabs>
      </div>
    </RequireModule>
  );
};

export default Retail;
