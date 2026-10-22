// Diseños de etiqueta del negocio (0042). Los ven todos; los guardan quienes pueden ajustar stock
// (lo comprueba la RLS). Sin diseños guardados se usa el «Etiquetas OK» de Stockagile.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { DEFAULT_LABEL_CONFIG, normalizeLabelConfig, type LabelConfig } from '@/lib/labels';

export interface LabelTemplate {
  id: string | null;
  name: string;
  config: LabelConfig;
  is_default: boolean;
}

export const BUILTIN_TEMPLATE: LabelTemplate = { id: null, name: 'Etiquetas OK', config: DEFAULT_LABEL_CONFIG, is_default: true };

// Tabla nueva de la 0042: `as never` hasta que se regenere types.ts.
const table = () => supabase.from('label_templates' as never) as unknown as ReturnType<typeof supabase.from>;

export function useLabelTemplates() {
  const { activeBusiness } = useBusiness();
  const businessId = activeBusiness?.id ?? null;
  const [templates, setTemplates] = useState<LabelTemplate[]>([BUILTIN_TEMPLATE]);
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await table()
      .select('id, name, config, is_default')
      .eq('business_id', businessId)
      .order('is_default', { ascending: false })
      .order('name');
    if (error) return;
    const rows = ((data ?? []) as unknown as { id: string; name: string; config: unknown; is_default: boolean }[]).map((r) => ({
      ...r,
      config: normalizeLabelConfig(r.config),
    }));
    setTemplates(rows.length ? rows : [BUILTIN_TEMPLATE]);
  }, [businessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Guarda el diseño (nuevo si no tiene id) y devuelve su id. */
  const save = useCallback(
    async (t: LabelTemplate, asNew = false): Promise<string | null> => {
      if (!businessId) return null;
      setIsSaving(true);
      const payload = { business_id: businessId, name: t.name.trim(), config: t.config, updated_at: new Date().toISOString() };
      const isFirst = templates.every((x) => x.id === null);
      const { data, error } =
        t.id && !asNew
          ? await table().update(payload as never).eq('id', t.id).select('id').single()
          : await table().insert({ ...payload, is_default: isFirst } as never).select('id').single();
      setIsSaving(false);
      if (error) {
        toast.error(/name_key/.test(error.message) ? 'Ya hay un diseño con ese nombre' : error.message || 'No se pudo guardar el diseño');
        return null;
      }
      toast.success('Diseño guardado');
      await reload();
      return (data as { id: string }).id;
    },
    [businessId, templates, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await table().delete().eq('id', id);
      if (error) toast.error('No se pudo borrar el diseño');
      else {
        toast.success('Diseño borrado');
        await reload();
      }
    },
    [reload],
  );

  return { templates, save, remove, isSaving, reload };
}
