import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { MoreHorizontal, Pencil, UserX, UserCheck, Users } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { ClientWithStats } from '@/hooks/useClientList';
import { eur } from '@/lib/clientHistory';

interface ClientsTableProps {
  clients: ClientWithStats[];
  isLoading: boolean;
  onOpen: (client: ClientWithStats) => void;
  onEdit: (client: ClientWithStats) => void;
  onToggleStatus: (id: string, currentStatus: boolean) => void;
  showInactive: boolean;
}

function LoadingSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-10" /></TableCell>
          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
          <TableCell><Skeleton className="h-8 w-8" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

function EmptyState({ showInactive }: { showInactive: boolean }) {
  return (
    <TableRow>
      <TableCell colSpan={8} className="h-48">
        <div className="flex flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No hay clientes</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {showInactive
              ? 'No tienes clientes registrados aún.'
              : 'No tienes clientes activos. Crea uno nuevo o muestra los inactivos.'}
          </p>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ClientsTable({
  clients,
  isLoading,
  onOpen,
  onEdit,
  onToggleStatus,
  showInactive,
}: ClientsTableProps) {
  const { isAdmin } = useRoleAccess('admin');
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead className="text-right">Compras</TableHead>
            <TableHead className="text-right">Gastado</TableHead>
            <TableHead>Última compra</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <LoadingSkeleton />
          ) : clients.length === 0 ? (
            <EmptyState showInactive={showInactive} />
          ) : (
            clients.map((client) => (
              <TableRow
                key={client.id}
                className="cursor-pointer"
                onClick={() => onOpen(client)}
                title="Ver ficha y compras"
              >
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {client.email || '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {client.phone || '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{client.purchases || '-'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {client.spent > 0 ? eur(client.spent) : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {client.last_purchase_at ? format(new Date(client.last_purchase_at), 'd MMM yyyy', { locale: es }) : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={client.is_active ? 'default' : 'secondary'}>
                    {client.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Acciones</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(client)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onToggleStatus(client.id, client.is_active)}
                      >
                        {client.is_active ? (
                          <>
                            <UserX className="mr-2 h-4 w-4" />
                            Desactivar
                          </>
                        ) : (
                          <>
                            <UserCheck className="mr-2 h-4 w-4" />
                            Reactivar
                          </>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
