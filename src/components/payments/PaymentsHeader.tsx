import { useState, useEffect } from 'react';
import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRoleAccess } from '@/hooks/useRoleAccess';

interface PaymentsHeaderProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onNewPayment: () => void;
}

export function PaymentsHeader({
  searchTerm,
  onSearchChange,
  onNewPayment,
}: PaymentsHeaderProps) {
  // 0031: los cobros los registran los administradores.
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
          <h1 className="text-2xl font-bold tracking-tight">Cobros</h1>
          <p className="text-muted-foreground">
            Registra y gestiona los cobros de tus facturas
          </p>
        </div>
        {isAdmin && (
          <Button onClick={onNewPayment}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo pago
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número de factura..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
    </div>
  );
}
