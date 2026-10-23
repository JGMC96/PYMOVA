// Marco común de las pantallas de tienda (TPV, Caja, Historial, Pedidos web, Inventario,
// Compras, Etiquetas y Vendedores). Antes eran pestañas de «Retail»; ahora cada una tiene su
// ruta y su entrada en el menú. La sesión de vendedor vive aquí para no perderla al cambiar
// de pantalla.
import { Outlet, useLocation } from 'react-router-dom';
import { RequireModule } from '@/components/auth/RequireModule';
import { SellerSessionProvider } from '@/contexts/SellerSessionContext';
import { SellerDialog } from '@/components/retail/SellerDialog';
import { ShopifyProblemsBanner } from '@/components/integrations/ShopifyProblemsBanner';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { useStoreProfile } from '@/hooks/useStoreProfile';

const PAGES: Record<string, { title: string; description?: string }> = {
  '/dashboard/sales/pos': { title: 'Nueva venta' },
  '/dashboard/sales/register': { title: 'Caja', description: 'Apertura, cierre y arqueo de la caja.' },
  '/dashboard/sales/history': { title: 'Historial de ventas', description: 'Tickets, devoluciones y reimpresiones.' },
  '/dashboard/sales/online': { title: 'Pedidos web', description: 'Pedidos de la tienda online.' },
  '/dashboard/stock/inventory': { title: 'Inventario', description: 'Stock por producto y talla.' },
  '/dashboard/stock/purchases': { title: 'Compras', description: 'Pedidos a proveedor y recepción de mercancía.' },
  '/dashboard/stock/labels': { title: 'Etiquetas', description: 'Diseño e impresión de etiquetas con código de barras.' },
  '/dashboard/team/sellers': { title: 'Vendedores', description: 'Quién vende en el TPV, sus PIN y sus permisos.' },
};

export function RetailLayout() {
  const { pathname } = useLocation();
  const { isAdmin } = useRoleAccess('admin');
  const { profile } = useStoreProfile();
  const page = PAGES[pathname.replace(/\/$/, '')];
  // En el TPV, el tipo de tienda (se cambia en Configuración › Tienda).
  const description = page?.description ?? profile.description;

  return (
    <RequireModule module="retail">
      <SellerSessionProvider>
        <SellerDialog />
        <div className="space-y-6">
          {isAdmin && <ShopifyProblemsBanner />}
          {page && (
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">{page.title}</h1>
              <p className="text-muted-foreground mt-1">{description}</p>
            </div>
          )}
          <Outlet />
        </div>
      </SellerSessionProvider>
    </RequireModule>
  );
}
