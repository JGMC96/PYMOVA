import { useState, useEffect } from 'react';
import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useRoleAccess } from '@/hooks/useRoleAccess';

interface ClientsHeaderProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  showInactive: boolean;
  onShowInactiveChange: (show: boolean) => void;
  onNewClient: () => void;
}

export function ClientsHeader({
  searchTerm,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  onNewClient,
}: ClientsHeaderProps) {
  // 0031: el personal consulta clientes; los crean y editan los administradores.
  const { isAdmin } = useRoleAccess('admin');
  const [localSearch, setLocalSearch] = useState(searchTerm);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);

    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  // Sync external changes
  useEffect(() => {
    setLocalSearch(searchTerm);
  }, [searchTerm]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona los clientes de tu negocio
          </p>
        </div>
        {isAdmin && (
          <Button onClick={onNewClient}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo cliente
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, email o teléfono..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={onShowInactiveChange}
          />
          <Label htmlFor="show-inactive" className="text-sm cursor-pointer">
            Mostrar inactivos
          </Label>
        </div>
      </div>
    </div>
  );
}
