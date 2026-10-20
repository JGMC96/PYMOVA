import { useState } from 'react';
import {
  Users,
  UserPlus,
  Copy,
  Check,
  Ban,
  Crown,
  UserCog,
  User as UserIcon,
  Mail,
  Send,
  Loader2,
  UserMinus,
  LogOut,
  History,
} from 'lucide-react';
import { useTeam, type TeamInvitation, type TeamMember } from '@/hooks/useTeam';
import { useBusiness } from '@/contexts/BusinessContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { buildInviteLink } from '@/lib/inviteLink';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('es-ES') : '';

const isExpired = (inv: TeamInvitation) =>
  inv.status === 'pending' && new Date(inv.expires_at).getTime() < Date.now();

/** Estado de una invitación para el historial, con su fecha. */
function invitationState(inv: TeamInvitation): { label: string; detail: string; variant: 'secondary' | 'outline' | 'destructive' } {
  if (inv.status === 'accepted') {
    return { label: 'Aceptada', detail: `el ${fecha(inv.accepted_at ?? inv.updated_at)}`, variant: 'secondary' };
  }
  if (inv.status === 'revoked') {
    return { label: 'Revocada', detail: `el ${fecha(inv.updated_at)}`, variant: 'outline' };
  }
  if (inv.status === 'expired' || isExpired(inv)) {
    return { label: 'Caducada', detail: `el ${fecha(inv.expires_at)}`, variant: 'destructive' };
  }
  return { label: inv.status, detail: '', variant: 'outline' };
}

type Confirm = { kind: 'remove'; member: TeamMember } | { kind: 'leave' } | null;

export function TeamSettings() {
  const { user, refreshBusinesses } = useBusiness();
  const { isOwner, isAdmin } = useRoleAccess('admin');
  const {
    members,
    invitations,
    isLoading,
    sendingId,
    resendInvitation,
    inviteUser,
    revokeInvitation,
    updateMemberRole,
    setMemberActive,
    removeMember,
    leaveBusiness,
    transferOwnership,
  } = useTeam();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('staff');
  const [submitting, setSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [working, setWorking] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState<string>('');
  const [keepOwner, setKeepOwner] = useState(false);

  // Las caducadas pasan al historial aunque en la base sigan como «pending».
  const pendingInvites = invitations.filter((i) => i.status === 'pending' && !isExpired(i));
  const historyInvites = invitations.filter((i) => i.status !== 'pending' || isExpired(i));

  const activeOwners = members.filter((m) => m.role === 'owner' && m.is_active).length;
  const transferCandidates = members.filter(
    (m) => m.user_id !== user?.id && m.is_active && m.role !== 'owner',
  );
  const nameOf = (userId: string | null) => {
    if (!userId) return null;
    const m = members.find((x) => x.user_id === userId);
    return m ? m.full_name || m.email : null;
  };

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

  const handleConfirm = async () => {
    if (!confirm) return;
    setWorking(true);
    if (confirm.kind === 'remove') {
      await removeMember(confirm.member.user_id);
      setWorking(false);
      setConfirm(null);
      return;
    }
    const ok = await leaveBusiness();
    setWorking(false);
    setConfirm(null);
    // Sin este negocio, RequireBusiness lleva a elegir otro o a crear uno.
    if (ok) await refreshBusinesses();
  };

  const handleTransfer = async () => {
    if (!transferTo) return;
    setWorking(true);
    const ok = await transferOwnership(transferTo, keepOwner);
    setWorking(false);
    if (ok) {
      setTransferOpen(false);
      setTransferTo('');
      setKeepOwner(false);
      // Si deja de ser propietario, cambian sus permisos en todo el panel.
      await refreshBusinesses();
    }
  };

  // Desde la 0030, un administrador solo gestiona al personal.
  const assignableRoles: AppRole[] = isOwner ? ['owner', 'admin', 'staff'] : ['staff'];

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
              Invita a nuevas personas y gestiona sus permisos. Enviamos la invitación por
              correo automáticamente; también puedes copiar el enlace y compartirlo tú
              (WhatsApp, email…). Quien lo abra podrá entrar con Google usando ese mismo correo.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {isOwner && transferCandidates.length > 0 && (
              <Button variant="outline" onClick={() => setTransferOpen(true)}>
                <Crown className="mr-2 h-4 w-4" />
                Transferir la propiedad
              </Button>
            )}
            {isAdmin && (
              <Button onClick={() => setDialogOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invitar
              </Button>
            )}
          </div>
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
              // El propietario gestiona a todos; un administrador, solo al personal.
              const canEdit = isAdmin && !isSelf && (isOwner || m.role === 'staff');
              const lastOwner = isSelf && m.role === 'owner' && activeOwners <= 1;
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

                  <div className="flex flex-wrap items-center gap-2">
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
                          {/* El rol actual siempre aparece, aunque no se pueda asignar. */}
                          {Array.from(new Set<AppRole>([m.role, ...assignableRoles])).map((r) => (
                            <SelectItem key={r} value={r} disabled={!assignableRoles.includes(r)}>
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

                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirm({ kind: 'remove', member: m })}
                      >
                        <UserMinus className="mr-2 h-4 w-4" />
                        Quitar
                      </Button>
                    )}

                    {isSelf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={lastOwner}
                        title={lastOwner ? 'Eres el único propietario: transfiere antes la propiedad' : undefined}
                        onClick={() => setConfirm({ kind: 'leave' })}
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        Salir del negocio
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
                      {ROLE_LABEL[inv.role]} · caduca el {fecha(inv.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sendingId === inv.id}
                      onClick={() => resendInvitation(inv)}
                    >
                      {sendingId === inv.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      {sendingId === inv.id ? 'Enviando...' : 'Reenviar'}
                    </Button>
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

      {isAdmin && historyInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Historial de invitaciones
            </CardTitle>
            <CardDescription>
              Invitaciones aceptadas, revocadas o caducadas. Para volver a invitar a alguien,
              crea una invitación nueva.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyInvites.map((inv) => {
              const st = invitationState(inv);
              const by = nameOf(inv.invited_by);
              return (
                <div
                  key={inv.id}
                  className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inv.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {ROLE_LABEL[inv.role]} · enviada el {fecha(inv.created_at)}
                      {by ? ` por ${by}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <span>{st.detail}</span>
                  </div>
                </div>
              );
            })}
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

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir la propiedad</DialogTitle>
            <DialogDescription>
              La persona elegida pasa a ser propietaria del negocio, con todos los permisos. Si no
              marcas la casilla, tú pasas a administrador.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-to">Nuevo propietario</Label>
              <Select value={transferTo} onValueChange={setTransferTo}>
                <SelectTrigger id="transfer-to">
                  <SelectValue placeholder="Elige a una persona del equipo" />
                </SelectTrigger>
                <SelectContent>
                  {transferCandidates.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {(m.full_name || m.email || 'Sin nombre') + ` · ${ROLE_LABEL[m.role]}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="keep-owner"
                checked={keepOwner}
                onCheckedChange={(v) => setKeepOwner(v === true)}
              />
              <Label htmlFor="keep-owner" className="font-normal">
                Seguir siendo propietario yo también
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleTransfer} disabled={!transferTo || working}>
              {working ? 'Transfiriendo...' : 'Transferir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'remove'
                ? `¿Quitar a ${confirm.member.full_name || confirm.member.email || 'esta persona'} del negocio?`
                : '¿Salir de este negocio?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'remove'
                ? 'Dejará de tener acceso al negocio y se cerrará su sesión de vendedor. Sus ventas, fichajes y su ficha de empleado se conservan. Para que vuelva, tendrás que invitarla de nuevo.'
                : 'Dejarás de tener acceso a este negocio. Tus ventas y fichajes se conservan. Para volver, alguien tendrá que invitarte de nuevo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
            >
              {working ? 'Un momento...' : confirm?.kind === 'remove' ? 'Quitar' : 'Salir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
