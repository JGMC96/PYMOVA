import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { getStoreProfile, type StoreProfile } from '@/lib/storeProfiles';

export function useStoreProfile() {
  const { activeBusiness } = useBusiness();
  const [profileKey, setProfileKey] = useState<StoreProfile>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!activeBusiness?.id) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('businesses')
      .select('store_profile')
      .eq('id', activeBusiness.id)
      .maybeSingle();

    if (!error && data) {
      setProfileKey((data.store_profile as StoreProfile) ?? 'general');
    }
    setIsLoading(false);
  }, [activeBusiness?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = async (key: StoreProfile): Promise<boolean> => {
    if (!activeBusiness?.id) return false;
    setIsSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update({ store_profile: key })
      .eq('id', activeBusiness.id);
    setIsSaving(false);

    if (error) {
      console.error('Error updating store profile:', error);
      toast.error('No se pudo cambiar el tipo de tienda');
      return false;
    }
    setProfileKey(key);
    toast.success('Tipo de tienda actualizado');
    return true;
  };

  return {
    profileKey,
    profile: getStoreProfile(profileKey),
    isLoading,
    isSaving,
    updateProfile,
  };
}
