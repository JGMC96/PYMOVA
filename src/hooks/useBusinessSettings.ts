import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import type { BusinessSettings } from '@/types/database';

export interface UpdateSettingsData {
  invoice_prefix?: string;
  tax_rate?: number;
  ticket_address?: string | null;
  ticket_phone?: string | null;
  ticket_website?: string | null;
  ticket_header?: string | null;
  ticket_footer?: string | null;
  ticket_return_policy?: string | null;
  ticket_show_logo?: boolean;
  ticket_trade_name?: string | null;
  ticket_legal_name?: string | null;
  ticket_tax_id?: string | null;
  ticket_font_size?: 'small' | 'normal' | 'large' | 'xlarge';
  ticket_line_spacing?: 'compact' | 'normal' | 'relaxed';
  ticket_bold_items?: boolean;
}

interface UseBusinessSettingsReturn {
  settings: BusinessSettings | null;
  isLoading: boolean;
  taxRate: number;
  updateSettings: (data: UpdateSettingsData) => Promise<boolean>;
  isUpdating: boolean;
  refetch: () => Promise<void>;
}

export function useBusinessSettings(): UseBusinessSettingsReturn {
  const { activeBusinessId } = useBusiness();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!activeBusinessId) {
      setSettings(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('business_settings')
        .select('*')
        .eq('business_id', activeBusinessId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found, which is OK (use defaults)
        console.error('Error fetching business settings:', error);
      }

      setSettings(data as BusinessSettings | null);
    } catch (err) {
      console.error('Error fetching business settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (data: UpdateSettingsData): Promise<boolean> => {
    if (!activeBusinessId) return false;

    setIsUpdating(true);
    try {
      // Check if settings exist
      const { data: existing } = await supabase
        .from('business_settings')
        .select('id')
        .eq('business_id', activeBusinessId)
        .single();

      let error;

      if (existing) {
        // Update existing settings
        const result = await supabase
          .from('business_settings')
          .update({
            ...data,
            updated_at: new Date().toISOString(),
          })
          .eq('business_id', activeBusinessId);
        error = result.error;
      } else {
        // Insert new settings
        const result = await supabase
          .from('business_settings')
          .insert({
            ...data,
            business_id: activeBusinessId,
            invoice_prefix: data.invoice_prefix ?? 'FAC-',
            tax_rate: data.tax_rate ?? 16,
          });
        error = result.error;
      }

      if (error) {
        console.error('Error updating business settings:', error);
        toast.error('Error al guardar configuración');
        return false;
      }

      // Refetch to update local state
      await fetchSettings();
      toast.success('Configuración guardada');
      return true;
    } catch (err) {
      console.error('Error updating business settings:', err);
      toast.error('Error al guardar configuración');
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  // Default tax rate if no settings exist
  const taxRate = settings?.tax_rate ?? 16;

  return { 
    settings, 
    isLoading, 
    taxRate, 
    updateSettings, 
    isUpdating,
    refetch: fetchSettings,
  };
}
