import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useToast } from '@/hooks/use-toast';
import type {
  MarketingPost,
  MarketingContentType,
  MarketingChannel,
  MarketingStatus,
} from '@/types/database';

export interface MarketingPostFormData {
  title: string;
  copy?: string;
  content_type: MarketingContentType;
  channels: MarketingChannel[];
  status: MarketingStatus;
  scheduled_at?: string | null;
  assignee_id?: string | null;
  reference_url?: string;
  hashtags?: string;
  notes?: string;
}

export interface MarketingFilters {
  contentType?: MarketingContentType | 'all';
  channel?: MarketingChannel | 'all';
  status?: MarketingStatus | 'all';
  assigneeId?: string | 'all';
}

export interface TeamMember {
  user_id: string;
  full_name: string | null;
}

interface UseMarketingPostsReturn {
  posts: MarketingPost[];
  teamMembers: TeamMember[];
  isLoading: boolean;
  error: Error | null;
  filters: MarketingFilters;
  setFilters: (f: MarketingFilters) => void;
  fetchPosts: () => Promise<void>;
  createPost: (data: MarketingPostFormData) => Promise<boolean>;
  updatePost: (id: string, data: MarketingPostFormData) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
}

export function useMarketingPosts(): UseMarketingPostsReturn {
  const { activeBusinessId, user } = useBusiness();
  const { toast } = useToast();

  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<MarketingFilters>({});

  const requestIdRef = useRef(0);

  const runFetch = useCallback(
    async (requestId: number) => {
      if (!activeBusinessId) {
        if (requestId === requestIdRef.current) {
          setPosts([]);
          setIsLoading(false);
        }
        return;
      }

      try {
        let query = supabase
          .from('marketing_posts')
          .select('*')
          .eq('business_id', activeBusinessId)
          .order('scheduled_at', { ascending: true, nullsFirst: false });

        if (filters.contentType && filters.contentType !== 'all') {
          query = query.eq('content_type', filters.contentType);
        }
        if (filters.status && filters.status !== 'all') {
          query = query.eq('status', filters.status);
        }
        if (filters.channel && filters.channel !== 'all') {
          query = query.contains('channels', [filters.channel]);
        }
        if (filters.assigneeId && filters.assigneeId !== 'all') {
          query = query.eq('assignee_id', filters.assigneeId);
        }

        const { data, error: fetchError } = await query;
        if (requestId !== requestIdRef.current) return;
        if (fetchError) throw fetchError;

        setPosts((data || []) as MarketingPost[]);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('Error fetching marketing posts:', err);
        setError(err instanceof Error ? err : new Error('Error al cargar publicaciones'));
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [activeBusinessId, filters]
  );

  const fetchPosts = useCallback(async () => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    await runFetch(newRequestId);
  }, [runFetch]);

  useEffect(() => {
    const newRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    runFetch(newRequestId);
  }, [runFetch]);

  // Fetch team members (active members of the business + their profile name)
  useEffect(() => {
    if (!activeBusinessId) {
      setTeamMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('business_members')
        .select('user_id, profiles(full_name)')
        .eq('business_id', activeBusinessId)
        .eq('is_active', true);

      if (cancelled) return;
      if (err) {
        console.error('Error fetching team members:', err);
        setTeamMembers([]);
        return;
      }

      const members: TeamMember[] = (data || []).map((m) => ({
        user_id: m.user_id as string,
        full_name:
          (m as { profiles: { full_name: string | null } | null }).profiles?.full_name ?? null,
      }));
      setTeamMembers(members);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId]);

  const normalize = (data: MarketingPostFormData) => ({
    title: data.title.trim(),
    copy: data.copy?.trim() || null,
    content_type: data.content_type,
    channels: data.channels,
    status: data.status,
    scheduled_at: data.scheduled_at || null,
    assignee_id: data.assignee_id || null,
    reference_url: data.reference_url?.trim() || null,
    hashtags: data.hashtags?.trim() || null,
    notes: data.notes?.trim() || null,
  });

  const createPost = useCallback(
    async (data: MarketingPostFormData) => {
      if (!activeBusinessId || !user) {
        toast({ title: 'Error', description: 'No hay negocio activo', variant: 'destructive' });
        return false;
      }
      try {
        const { error: insertError } = await supabase.from('marketing_posts').insert({
          business_id: activeBusinessId,
          created_by: user.id,
          ...normalize(data),
        });
        if (insertError) throw insertError;
        toast({ title: 'Publicación creada', description: 'Se añadió al calendario' });
        await fetchPosts();
        return true;
      } catch (err) {
        console.error('Error creating post:', err);
        toast({
          title: 'Error al crear',
          description: err instanceof Error ? err.message : 'Error inesperado',
          variant: 'destructive',
        });
        return false;
      }
    },
    [activeBusinessId, user, fetchPosts, toast]
  );

  const updatePost = useCallback(
    async (id: string, data: MarketingPostFormData) => {
      if (!activeBusinessId) return false;
      try {
        const { error: updateError } = await supabase
          .from('marketing_posts')
          .update(normalize(data))
          .eq('id', id)
          .eq('business_id', activeBusinessId);
        if (updateError) throw updateError;
        toast({ title: 'Publicación actualizada' });
        await fetchPosts();
        return true;
      } catch (err) {
        console.error('Error updating post:', err);
        toast({
          title: 'Error al actualizar',
          description: err instanceof Error ? err.message : 'Error inesperado',
          variant: 'destructive',
        });
        return false;
      }
    },
    [activeBusinessId, fetchPosts, toast]
  );

  const deletePost = useCallback(
    async (id: string) => {
      if (!activeBusinessId) return false;
      try {
        const { error: deleteError } = await supabase
          .from('marketing_posts')
          .delete()
          .eq('id', id)
          .eq('business_id', activeBusinessId);
        if (deleteError) throw deleteError;
        toast({ title: 'Publicación eliminada' });
        await fetchPosts();
        return true;
      } catch (err) {
        console.error('Error deleting post:', err);
        toast({
          title: 'Error al eliminar',
          description: err instanceof Error ? err.message : 'Error inesperado',
          variant: 'destructive',
        });
        return false;
      }
    },
    [activeBusinessId, fetchPosts, toast]
  );

  return {
    posts,
    teamMembers,
    isLoading,
    error,
    filters,
    setFilters,
    fetchPosts,
    createPost,
    updatePost,
    deletePost,
  };
}
