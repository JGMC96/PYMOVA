import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/hooks/use-toast';
import { buildInviteLink } from '@/lib/inviteLink';
import type { AppRole } from '@/types/database';

const ROLE_LABEL: Record<AppRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  staff: 'Personal',
};


export interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole;
  is_active: boolean;
  joined_at: string | null;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: AppRole;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export function useTeam() {
  const { activeBusinessId, user } = useBusiness();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!activeBusinessId) {
      setMembers([]);
      setInvitations([]);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    const [teamRes, invRes] = await Promise.all([
      supabase.rpc('get_business_team', { _business_id: activeBusinessId }),
      supabase
        .from('business_invitations')
        .select('id, email, role, token, status, expires_at, created_at')
        .eq('business_id', activeBusinessId)
        .order('created_at', { ascending: false }),
    ]);

    if (requestId !== requestIdRef.current) return;

    if (teamRes.error) {
      console.error('get_business_team failed:', teamRes.error);
      toast({ title: 'Error', description: teamRes.error.message, variant: 'destructive' });
    } else {
      setMembers((teamRes.data ?? []) as TeamMember[]);
    }

    if (invRes.error) {
      // Staff members cannot read invitations — silent
      setInvitations([]);
    } else {
      setInvitations((invRes.data ?? []) as TeamInvitation[]);
    }

    setIsLoading(false);
  }, [activeBusinessId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const inviteUser = useCallback(
    async (email: string, role: AppRole) => {
      if (!activeBusinessId || !user) return null;

      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase
        .from('business_invitations')
        .insert({
          business_id: activeBusinessId,
          email: cleanEmail,
          role,
          invited_by: user.id,
        })
        .select('id, email, role, token, status, expires_at, created_at')
        .single();

      if (error) {
        const duplicate = error.code === '23505';
        toast({
          title: 'No se pudo invitar',
          description: duplicate
            ? 'Ya existe una invitación pendiente para este correo.'
            : error.message,
          variant: 'destructive',
        });
        return null;
      }

      toast({ title: 'Invitación creada', description: `Comparte el enlace con ${cleanEmail}.` });
      await fetchAll();
      return data as TeamInvitation;
    },
    [activeBusinessId, user, fetchAll],
  );

  const revokeInvitation = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('business_invitations')
        .update({ status: 'revoked' })
        .eq('id', id);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return false;
      }
      toast({ title: 'Invitación revocada' });
      await fetchAll();
      return true;
    },
    [fetchAll],
  );

  const updateMemberRole = useCallback(
    async (userId: string, role: AppRole) => {
      if (!activeBusinessId) return false;
      const { error } = await supabase
        .from('business_members')
        .update({ role })
        .eq('business_id', activeBusinessId)
        .eq('user_id', userId);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return false;
      }
      toast({ title: 'Rol actualizado' });
      await fetchAll();
      return true;
    },
    [activeBusinessId, fetchAll],
  );

  const setMemberActive = useCallback(
    async (userId: string, isActive: boolean) => {
      if (!activeBusinessId) return false;
      const { error } = await supabase
        .from('business_members')
        .update({ is_active: isActive })
        .eq('business_id', activeBusinessId)
        .eq('user_id', userId);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return false;
      }
      toast({ title: isActive ? 'Acceso restaurado' : 'Acceso suspendido' });
      await fetchAll();
      return true;
    },
    [activeBusinessId, fetchAll],
  );

  return {
    members,
    invitations,
    isLoading,
    refetch: fetchAll,
    inviteUser,
    revokeInvitation,
    updateMemberRole,
    setMemberActive,
  };
}
