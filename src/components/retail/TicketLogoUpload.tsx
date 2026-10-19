import { useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';

/** Reduce el logo a 384 px de ancho (resolución de impresora térmica) y lo devuelve como PNG en base64. */
async function resizeLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const scale = Math.min(1, 384 / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

export function TicketLogoUpload({ disabled }: { disabled?: boolean }) {
  const { activeBusiness, refreshBusinesses } = useBusiness();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const logo = (activeBusiness as { logo_url?: string | null } | null)?.logo_url;

  const save = async (value: string | null) => {
    if (!activeBusiness) return;
    setBusy(true);
    const { error } = await supabase.from('businesses').update({ logo_url: value }).eq('id', activeBusiness.id);
    if (error) toast.error('No se pudo guardar el logo');
    else { await refreshBusinesses(); toast.success(value ? 'Logo guardado' : 'Logo quitado'); }
    setBusy(false);
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast.error('Elige una imagen (PNG o JPG)');
    try { await save(await resizeLogo(f)); } catch { toast.error('No se pudo leer la imagen'); }
    if (input.current) input.current.value = '';
  };

  return (
    <div className="flex items-center gap-3">
      <div className="h-14 w-24 rounded border bg-background flex items-center justify-center overflow-hidden">
        {logo ? <img src={logo} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">Sin logo</span>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
        <ImageUp className="w-4 h-4 mr-2" />{logo ? 'Cambiar logo' : 'Subir logo'}
      </Button>
      {logo && (
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => save(null)}>
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
