// Menú lateral por áreas (como Stockagile). Cada entrada puede pedir un módulo del plan y
// un permiso de la persona:
// - módulo fuera del plan → se ve con candado (para mejorar el plan);
// - sin el permiso → no se ve (un dependiente solo ve lo que usa);
// - un área sin entradas visibles no se pinta.
import {
  BarChart3,
  ClipboardList,
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Package,
  Receipt,
  ScanBarcode,
  ShoppingCart,
  Tag,
  Truck,
  UserCog,
  Users,
  Clock,
  CalendarDays,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@/types/database';

export interface MenuAccess {
  enabledModules: ModuleKey[];
  isAdmin: boolean;
  isOwner: boolean;
  canAdjustStock: boolean;
  /** Permiso «Productos y precios» (0031). */
  canEditCatalog?: boolean;
}

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
  moduleKey?: ModuleKey;
  /** Permiso de la persona: si devuelve false, la entrada no se ve. */
  allowed?: (access: MenuAccess) => boolean;
}

export interface MenuSection {
  /** Sin título: entradas sueltas (Inicio, Asesor IA). */
  title?: string;
  items: MenuItem[];
}

export interface VisibleMenuItem extends MenuItem {
  /** El módulo no entra en el plan: se ve con candado. */
  locked: boolean;
}

export interface VisibleMenuSection {
  title?: string;
  items: VisibleMenuItem[];
}

const adminOnly = (a: MenuAccess) => a.isAdmin;
const ownerOnly = (a: MenuAccess) => a.isOwner;

export const MENU_SECTIONS: MenuSection[] = [
  { items: [{ icon: LayoutDashboard, label: 'Inicio', path: '/dashboard' }] },
  {
    title: 'Ventas',
    items: [
      { icon: ShoppingCart, label: 'TPV', path: '/dashboard/sales/pos', moduleKey: 'retail' },
      { icon: Wallet, label: 'Caja', path: '/dashboard/sales/register', moduleKey: 'retail' },
      { icon: Receipt, label: 'Historial', path: '/dashboard/sales/history', moduleKey: 'retail' },
      { icon: Globe, label: 'Pedidos web', path: '/dashboard/sales/online', moduleKey: 'retail' },
    ],
  },
  {
    title: 'Productos y stock',
    items: [
      { icon: Package, label: 'Productos', path: '/dashboard/products', moduleKey: 'products' },
      { icon: ClipboardList, label: 'Inventario', path: '/dashboard/stock/inventory', moduleKey: 'retail' },
      {
        icon: Truck,
        label: 'Compras',
        path: '/dashboard/stock/purchases',
        moduleKey: 'retail',
        allowed: (a) => a.canAdjustStock,
      },
      { icon: Tag, label: 'Etiquetas', path: '/dashboard/stock/labels', moduleKey: 'retail' },
      {
        icon: ScanBarcode,
        label: 'Códigos',
        path: '/dashboard/stock/codes',
        moduleKey: 'retail',
        allowed: (a) => !!a.canEditCatalog,
      },
    ],
  },
  {
    title: 'Clientes',
    items: [{ icon: Users, label: 'Clientes', path: '/dashboard/clients', moduleKey: 'clients' }],
  },
  {
    title: 'Facturación',
    items: [
      // 0050: facturas y cobros, solo administradores (el personal ya no los lee).
      { icon: FileText, label: 'Facturas', path: '/dashboard/invoices', moduleKey: 'invoicing', allowed: adminOnly },
      { icon: CreditCard, label: 'Cobros', path: '/dashboard/payments', moduleKey: 'payments', allowed: adminOnly },
    ],
  },
  {
    title: 'Marketing',
    items: [{ icon: CalendarDays, label: 'Marketing', path: '/dashboard/marketing', moduleKey: 'marketing' }],
  },
  {
    title: 'Equipo',
    items: [
      { icon: Clock, label: 'RRHH', path: '/dashboard/hr', moduleKey: 'hr' },
      {
        icon: UserCog,
        label: 'Vendedores',
        path: '/dashboard/team/sellers',
        moduleKey: 'retail',
        allowed: adminOnly,
      },
    ],
  },
  {
    title: 'Informes',
    items: [
      // Solo el propietario: lo comprueba cada RPC (`has_business_role(..., 'owner')`).
      { icon: BarChart3, label: 'Informes', path: '/dashboard/informes', allowed: ownerOnly },
    ],
  },
  { items: [{ icon: MessageSquare, label: 'Asesor IA', path: '/dashboard/ai', moduleKey: 'ai_advisor' }] },
];

/** Las áreas y entradas que ve esta persona, con candado si el módulo no está en su plan. */
export function visibleMenu(sections: MenuSection[], access: MenuAccess): VisibleMenuSection[] {
  return sections
    .map((section) => ({
      title: section.title,
      items: section.items
        .filter((item) => !item.allowed || item.allowed(access))
        .map((item) => ({
          ...item,
          locked: !!item.moduleKey && !access.enabledModules.includes(item.moduleKey),
        })),
    }))
    .filter((section) => section.items.length > 0);
}

/** ¿La entrada está activa en esta ruta? Inicio solo en /dashboard exacto. */
export function isMenuItemActive(path: string, pathname: string): boolean {
  if (path === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/';
  return pathname === path || pathname.startsWith(path + '/');
}

/** Adonde llevan las rutas antiguas de Retail (enlaces guardados). */
export const RETAIL_HOME = '/dashboard/sales/pos';

/** Integraciones está ahora en Configuración. */
export const INTEGRATIONS_SETTINGS = '/dashboard/settings?tab=integrations';
