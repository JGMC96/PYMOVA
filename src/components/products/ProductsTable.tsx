import { Package, MoreHorizontal, Edit, Power, PowerOff } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Product } from '@/types/database';

interface ProductsTableProps {
  products: Product[];
  isLoading: boolean;
  searchTerm: string;
  onEdit: (product: Product) => void;
  onToggleStatus: (id: string, currentStatus: boolean) => void;
  onNewProduct: () => void;
}

// Format price with currency
const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(price);
};

export function ProductsTable({
  products,
  isLoading,
  searchTerm,
  onEdit,
  onToggleStatus,
  onNewProduct,
}: ProductsTableProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Empty state - no products at all
  if (products.length === 0 && !searchTerm) {
    return (
      <div className="rounded-md border p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-muted rounded-full mb-4">
            <Package className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No hay productos</h3>
          <p className="text-muted-foreground mb-4 max-w-sm">
            Comienza agregando tu primer producto o servicio al catálogo.
          </p>
          <Button onClick={onNewProduct}>
            Agregar primer producto
          </Button>
        </div>
      </div>
    );
  }

  // Empty state - no results for search
  if (products.length === 0 && searchTerm) {
    return (
      <div className="rounded-md border p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-muted rounded-full mb-4">
            <Package className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Sin resultados</h3>
          <p className="text-muted-foreground max-w-sm">
            No se encontraron productos que coincidan con "{searchTerm}".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Precio</TableHead>
            <TableHead>Coste</TableHead>
            <TableHead>Margen</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell className="font-medium">
                <div>
                  {product.name}
                  {product.description && (
                    <p className="text-sm text-muted-foreground truncate max-w-xs">
                      {product.description}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell>{product.category || '-'}</TableCell>
              <TableCell className="font-mono">
                {formatPrice(product.price)}
              </TableCell>
              <TableCell>{product.unit || '-'}</TableCell>
              <TableCell>
                <Badge variant={product.is_active ? 'default' : 'secondary'}>
                  {product.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Acciones</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(product)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => onToggleStatus(product.id, product.is_active)}
                    >
                      {product.is_active ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-2" />
                          Desactivar
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-2" />
                          Reactivar
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
