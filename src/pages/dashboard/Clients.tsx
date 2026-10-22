import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RequireModule } from '@/components/auth/RequireModule';
import { ClientsHeader } from '@/components/clients/ClientsHeader';
import { ClientsTable } from '@/components/clients/ClientsTable';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { ClientDetailSheet } from '@/components/clients/ClientDetailSheet';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClients } from '@/hooks/useClients';
import { CLIENT_PAGE_SIZE, useClientList, type ClientSort, type ClientWithStats } from '@/hooks/useClientList';

export default function Clients() {
  // La lista sale de list_clients_with_stats (paginada); useClients solo crea y edita.
  const { createClient, updateClient, toggleClientStatus } = useClients({ fetchList: false });
  const list = useClientList();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientWithStats | null>(null);
  const [openClient, setOpenClient] = useState<ClientWithStats | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNewClient = () => {
    setEditingClient(null);
    setDialogOpen(true);
  };

  const handleEditClient = (client: ClientWithStats) => {
    setEditingClient(client);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: Parameters<typeof createClient>[0]) => {
    setIsSubmitting(true);
    try {
      const ok = editingClient ? await updateClient(editingClient.id, data) : await createClient(data);
      if (ok) await list.refresh();
      return ok;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    if (await toggleClientStatus(id, current)) await list.refresh();
  };

  const from = list.total === 0 ? 0 : list.page * CLIENT_PAGE_SIZE + 1;
  const to = Math.min(list.total, (list.page + 1) * CLIENT_PAGE_SIZE);

  return (
    <RequireModule module="clients">
      <div className="space-y-6">
        <ClientsHeader
          searchTerm={list.searchTerm}
          onSearchChange={list.setSearchTerm}
          showInactive={list.showInactive}
          onShowInactiveChange={list.setShowInactive}
          onNewClient={handleNewClient}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Ordenar por</span>
            <Select value={list.sort} onValueChange={(v) => list.setSort(v as ClientSort)}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Nombre</SelectItem>
                <SelectItem value="spent">Más gastado</SelectItem>
                <SelectItem value="purchases">Más compras</SelectItem>
                <SelectItem value="last_purchase">Compra más reciente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {from}–{to} de {list.total.toLocaleString('es-ES')}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={list.page === 0 || list.isLoading}
              onClick={() => list.setPage(list.page - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={list.page + 1 >= list.pageCount || list.isLoading}
              onClick={() => list.setPage(list.page + 1)}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {list.error && <p className="text-sm text-destructive">{list.error}</p>}

        <ClientsTable
          clients={list.clients}
          isLoading={list.isLoading}
          onOpen={setOpenClient}
          onEdit={handleEditClient}
          onToggleStatus={handleToggle}
          showInactive={list.showInactive}
        />

        <ClientFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          client={editingClient}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />
        <ClientDetailSheet client={openClient} onClose={() => setOpenClient(null)} />
      </div>
    </RequireModule>
  );
}
