import { useState } from "react";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Bell, Menu, Search, LogOut, User as UserIcon, Settings, Loader2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface DashboardHeaderProps {
  user: User | null;
  onLogout: () => void | Promise<void>;
  onMenuToggle: () => void;
}

type LogoutStatus = "idle" | "loading" | "error";

export const DashboardHeader = ({ user, onLogout, onMenuToggle }: DashboardHeaderProps) => {
  const [status, setStatus] = useState<LogoutStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const userInitial = user?.email?.charAt(0).toUpperCase() || "U";
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";

  const isBusy = status === "loading";
  const modalOpen = status === "loading" || status === "error";

  const handleLogout = async () => {
    if (isBusy) return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      await onLogout();
      toast.success("Sesión cerrada correctamente");
      // El componente se desmonta tras navigate('/'), no reseteamos estado.
    } catch (err: any) {
      setErrorMsg(err?.message || "No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.");
      setStatus("error");
    }
  };

  const handleCancel = () => {
    setStatus("idle");
    setErrorMsg(null);
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-background/95 backdrop-blur-sm border-b border-border flex items-center justify-between px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <Menu className="w-5 h-5 text-foreground" />
        </button>
        
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="w-64 pl-9 bg-muted/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-muted transition-colors">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm">
                {userInitial}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-foreground">{userName}</p>
                <p className="text-xs text-muted-foreground truncate max-w-32">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserIcon className="w-4 h-4 mr-2" />
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="w-4 h-4 mr-2" />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={isBusy}
              className="text-destructive"
            >
              {isBusy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4 mr-2" />
              )}
              {isBusy ? "Cerrando sesión..." : "Cerrar sesión"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Modal bloqueante durante el cierre de sesión / error */}
      <Dialog open={modalOpen}>
        <DialogContent
          className="sm:max-w-sm"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {status === "loading" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <div>
                <p className="font-semibold text-foreground">Cerrando sesión...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Revocando acceso y limpiando datos locales.
                </p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No se pudo cerrar la sesión</p>
                <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
              </div>
              <div className="flex gap-2 w-full pt-2">
                <Button variant="outline" className="flex-1" onClick={handleCancel}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleLogout}>
                  Reintentar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </header>
  );
};
