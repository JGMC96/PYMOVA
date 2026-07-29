import { useState } from 'react';
import { Users, UserPlus, Copy, Check, Ban, Crown, UserCog, User as UserIcon, Mail } from 'lucide-react';
import { useTeam } from '@/hooks/useTeam';
import { useBusiness } from '@/contexts/BusinessContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { buildInviteLink } from '@/lib/inviteLink';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import type { AppRole } from '@/types/database';

const ROLE_LABEL: Record<AppRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  staff: 'Personal',
};

const ROLE_ICON: Record<AppRole, React.ElementType> = {
  owner: Crown,
  admin: UserCog,
  staff: UserIcon,
};

export function TeamSettings() {
  const { user } = useBusiness();
  const { isOwner, isAdmin } = useRoleAccess('admin');
  const {
    members,
    invitations,
    isLoading,
    inviteUser,
    revokeInvitation,
    updateMemberRole,
    setMemberActive,
  } = useTeam();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('staff');
  const [submitting, setSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const pendingInvites = invitations.filter((i) => i.status === 'pending');

  const inviteLink = (token: string) => buildInviteLink(token);

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteLink(token));
    setCopiedToken(token);
    toast({ title: 'Enlace copiado', description: 'Envíalo a la persona invitada.' });
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleInvite = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: 'Correo no válido', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const created = await inviteUser(email, role);
    setSubmitting(false);
    if (created) {
      setDialogOpen(false);
      setEmail('');
      setRole('staff');
      await handleCopy(created.token);
    }
  };

  const assignableRoles: AppRole[] = isOwner ? ['owner', 'admin', 'staff'] : ['admin', 'staff'];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Equipo
            </CardTitle>
            <CardDescription>
              Invita a nuevas personas y gestiona sus permisos. El enlace de invitación no se
              envía por correo todavía: cópialo y compártelo (WhatsApp, email…). Quien lo abra
              podrá entrar con Google usando ese mismo correo.
            </CardDescription>

          </div>
          {isAdmin && (
            <Button onClick={() => setDialogOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invitar
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No hay miembros todavía</p>
          ) : (
            members.map((m) => {
              const Icon = ROLE_ICON[m.role];
              const isSelf = m.user_id === user?.id;
              const canEdit = isAdmin && !isSelf && (isOwner || m.role !== 'owner');
              return (
                <div
                  key={m.user_id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-muted p-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.full_name || m.email || 'Sin nombre'}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!m.is_active && <Badge variant="destructive">Suspendido</Badge>}
                    {canEdit ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => updateMemberRole(m.user_id, v as AppRole)}
                      >
                        <SelectTrigger className="w-[170px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableRoles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{ROLE_LABEL[m.role]}</Badge>
                    )}

                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMemberActive(m.user_id, !m.is_active)}
                      >
                        {m.is_active ? 'Suspender' : 'Reactivar'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Invitaciones pendientes
            </CardTitle>
            <CardDescription>
              Las invitaciones caducan a los 14 días. Comparte el enlace con la persona invitada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingInvites.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">No hay invitaciones pendientes</p>
            ) : (
              pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inv.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {ROLE_LABEL[inv.role]} · caduca el{' '}
                      {new Date(inv.expires_at).toLocaleDateString('es-ES')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleCopy(inv.token)}>
                      {copiedToken === inv.token ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      Copiar enlace
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => revokeInvitation(inv.id)}>
                      <Ban className="mr-2 h-4 w-4" />
                      Revocar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitar a un nuevo usuario</DialogTitle>
            <DialogDescription>
              Se generará un enlace de invitación. La persona debe registrarse con este mismo correo
              para unirse al negocio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Correo electrónico</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="persona@empresa.com"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleInvite} disabled={submitting}>
              {submitting ? 'Creando...' : 'Crear invitación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
