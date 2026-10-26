// Pantallas de tienda que necesitan algo más que su panel: el TPV lleva a la Caja, el
// historial junta PYMOVA y Stockagile, y Compras y Vendedores piden permiso (el menú ya no
// las enseña sin él, pero se puede llegar por la dirección).
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { POSPanel } from '@/components/retail/POSPanel';
import { SalesHistory } from '@/components/retail/SalesHistory';
import { StockagileSalesPanel } from '@/components/retail/StockagileSalesPanel';
import { PurchasesPanel } from '@/components/purchases/PurchasesPanel';
import { SellersPanel } from '@/components/retail/SellersPanel';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useBusiness } from '@/contexts/BusinessContext';
import { findStockagileTickets, type StockagileSale } from '@/hooks/useStockagileSales';
import { STOCKAGILE_PILOT_BUSINESS_ID } from '../../../../supabase/functions/_shared/stockagile-core.ts';

function NoPermission({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
        <Lock className="w-5 h-5 flex-shrink-0" />
        {text}
      </CardContent>
    </Card>
  );
}

export function PosPage() {
  const navigate = useNavigate();
  return <POSPanel onGoToRegister={() => navigate('/dashboard/sales/register')} />;
}

export function SalesHistoryPage() {
  // Un solo buscador (el de PYMOVA) para los dos historiales: lo escrito filtra también los
  // tickets de Stockagile cargados, y con Intro se busca en toda la copia de Stockagile.
  const { activeBusinessId } = useBusiness();
  const withStockagile = activeBusinessId === STOCKAGILE_PILOT_BUSINESS_ID;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<StockagileSale[] | null>(null);

  const onQueryChange = useCallback((q: string) => {
    setQuery(q);
    setFound(null);
  }, []);

  const searchStockagile = useCallback(
    async (q: string) => {
      if (!activeBusinessId) return false;
      const tickets = await findStockagileTickets(activeBusinessId, q);
      if (tickets === null) {
        toast.error('No se pudo buscar en los tickets de Stockagile');
        return false;
      }
      setFound(tickets.length > 0 ? tickets : null);
      return tickets.length > 0;
    },
    [activeBusinessId],
  );

  return (
    <div className="space-y-6">
      <SalesHistory
        onQueryChange={withStockagile ? onQueryChange : undefined}
        searchElsewhere={withStockagile ? searchStockagile : undefined}
      />
      <StockagileSalesPanel query={query} found={found} onClearSearch={() => setFound(null)} />
    </div>
  );
}

export function PurchasesPage() {
  // Compras: quien puede ajustar stock (0040).
  const { canAdjustStock, isLoading } = useMyPermissions();
  if (isLoading) return null;
  if (!canAdjustStock) return <NoPermission text="Necesitas permiso para ajustar stock para ver las compras." />;
  return <PurchasesPanel />;
}

export function SellersPage() {
  const { isAdmin, isLoading } = useRoleAccess('admin');
  if (isLoading) return null;
  if (!isAdmin) return <NoPermission text="Solo propietarios y administradores gestionan los vendedores." />;
  return <SellersPanel />;
}
