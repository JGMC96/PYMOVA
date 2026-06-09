import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  CreditCard,
  ShoppingCart,
  MessageSquare,
  CalendarDays,
  Clock,
  Settings,
  ChevronLeft,
  Building2,
  Lock,
  ShieldCheck,
  LucideIcon,
} from "lucide-react";
import { PymovaLogo } from "@/components/landing/PymovaLogo";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/contexts/BusinessContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { toast } from "sonner";
import type { ModuleKey } from "@/types/database";

interface DashboardSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
  moduleKey?: ModuleKey;
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Users, label: "Clientes", path: "/dashboard/clients", moduleKey: "clients" },
  { icon: Package, label: "Productos", path: "/dashboard/products", moduleKey: "products" },
  { icon: FileText, label: "Facturas", path: "/dashboard/invoices", moduleKey: "invoicing" },
  { icon: CreditCard, label: "Pagos", path: "/dashboard/payments", moduleKey: "payments" },
  { icon: ShoppingCart, label: "Retail", path: "/dashboard/retail", moduleKey: "retail" },
  { icon: CalendarDays, label: "Marketing", path: "/dashboard/marketing", moduleKey: "marketing" },
  { icon: Clock, label: "RRHH", path: "/dashboard/hr", moduleKey: "hr" },
  { icon: MessageSquare, label: "Asesor IA", path: "/dashboard/ai", moduleKey: "ai_advisor" },
];

export const DashboardSidebar = ({ isOpen, onToggle }: DashboardSidebarProps) => {
  const location = useLocation();
  const { enabledModules, activeBusiness } = useBusiness();
  const { isSuperAdmin } = useSuperAdmin();

  return (
    <motion.aside
      initial={false}
      animate={{ width: isOpen ? 256 : 80 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border z-40 flex flex-col"
    >
      {/* Logo section */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
            <PymovaLogo className="w-6 h-6" />
          </div>
          {isOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-display font-bold text-lg text-sidebar-foreground"
            >
              Pymova
            </motion.span>
          )}
        </div>
      </div>

      {/* Business selector */}
      <div className="p-4 border-b border-sidebar-border">
        <button className={cn(
          "w-full flex items-center gap-3 p-3 rounded-xl bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 transition-colors",
          !isOpen && "justify-center"
        )}>
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-accent" />
          </div>
          {isOpen && (
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium truncate">
                {activeBusiness?.name || "Sin negocio"}
              </p>
              <p className="text-xs text-sidebar-foreground/60">
                Negocio activo
              </p>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = item.path === "/dashboard"
            ? location.pathname === "/dashboard"
            : location.pathname === item.path || location.pathname.startsWith(item.path + "/");
          const isModuleEnabled = !item.moduleKey || enabledModules.includes(item.moduleKey);

          if (!isModuleEnabled) {
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => toast.info("Mejora tu plan para acceder a este módulo", {
                  action: {
                    label: "Ver planes",
                    onClick: () => {/* futuro: navigate to pricing */}
                  }
                })}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl",
                  "text-sidebar-foreground/40 hover:bg-sidebar-accent/30 transition-colors",
                  !isOpen && "justify-center"
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {isOpen && (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm font-medium">{item.label}</span>
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                !isOpen && "justify-center"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {isOpen && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm font-medium"
                >
                  {item.label}
                </motion.span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Settings & collapse */}
      <div className="p-4 border-t border-sidebar-border space-y-1">
        {isSuperAdmin && (
          <Link
            to="/admin"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-amber-400 hover:bg-sidebar-accent transition-colors",
              !isOpen && "justify-center"
            )}
          >
            <ShieldCheck className="w-5 h-5 flex-shrink-0" />
            {isOpen && <span className="text-sm font-medium">Super Admin</span>}
          </Link>
        )}
        <Link
          to="/dashboard/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
            !isOpen && "justify-center"
          )}
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          {isOpen && <span className="text-sm font-medium">Configuración</span>}
        </Link>
        
        <button
          onClick={onToggle}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
            !isOpen && "justify-center"
          )}
        >
          <ChevronLeft className={cn(
            "w-5 h-5 flex-shrink-0 transition-transform",
            !isOpen && "rotate-180"
          )} />
          {isOpen && <span className="text-sm font-medium">Colapsar</span>}
        </button>
      </div>
    </motion.aside>
  );
};
