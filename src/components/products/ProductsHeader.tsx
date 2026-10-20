import { useState, useEffect } from 'react';
import { Search, Plus, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ProductsHeaderProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  showInactive: boolean;
  onShowInactiveChange: (show: boolean) => void;
  onNewProduct: () => void;
  /** Con permiso de catálogo (0031). */
  canCreate?: boolean;
}

export function ProductsHeader({
  searchTerm,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  onNewProduct,
  canCreate = true,
}: ProductsHeaderProps) {
  // Local state for debounced search
  const [localSearch, setLocalSearch] = useState(searchTerm);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);

    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  // Sync local state when external searchTerm changes
  useEffect(() => {
    setLocalSearch(searchTerm);
  }, [searchTerm]);

  return (
    <div className="space-y-4">
      {/* Title section */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Package className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
          <p className="text-muted-foreground">
            Gestiona el catálogo de productos y servicios de tu negocio
          </p>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Search input */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o categoría..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-4">
          {/* Show inactive toggle */}
          <div className="flex items-center space-x-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={onShowInactiveChange}
            />
            <Label htmlFor="show-inactive" className="text-sm text-muted-foreground">
              Mostrar inactivos
            </Label>
          </div>

          {/* New product button */}
          {canCreate && (
            <Button onClick={onNewProduct}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo producto
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
