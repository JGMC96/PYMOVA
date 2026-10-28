import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CAMPAIGN_COLORS } from '@/lib/marketingPlan';
import type { MarketingCampaign } from '@/types/database';
import type { CampaignFormData } from '@/hooks/useMarketingCampaigns';

const schema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
    kind: z.enum(['campaign', 'key_date']),
    starts_on: z.string().min(1, 'Pon la fecha de inicio'),
    ends_on: z.string().min(1, 'Pon la fecha de fin'),
    color: z.string().optional(),
    goal: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on, {
    message: 'La fecha de fin no puede ser anterior a la de inicio',
    path: ['ends_on'],
  });

type FormValues = z.infer<typeof schema>;

interface CampaignFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: MarketingCampaign | null;
  /** Número de publicaciones de la campaña (para avisar al borrarla). */
  postCount?: number;
  onSubmit: (data: CampaignFormData) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  readOnly?: boolean;
}

const EMPTY: FormValues = { name: '', kind: 'campaign', starts_on: '', ends_on: '', color: '', goal: '', notes: '' };

export function CampaignFormDialog({
  open,
  onOpenChange,
  campaign,
  postCount = 0,
  onSubmit,
  onDelete,
  readOnly = false,
}: CampaignFormDialogProps) {
  const isEditing = !!campaign;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(
      campaign
        ? {
            name: campaign.name,
            kind: campaign.kind,
            starts_on: campaign.starts_on,
            ends_on: campaign.ends_on,
            color: campaign.color ?? '',
            goal: campaign.goal ?? '',
            notes: campaign.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, campaign, form]);

  const handleSubmit = async (v: FormValues) => {
    const ok = await onSubmit({
      name: v.name,
      kind: v.kind,
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      color: v.color || null,
      goal: v.goal,
      notes: v.notes,
    });
    if (ok) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!campaign || !onDelete) return;
    const aviso = postCount
      ? `Las ${postCount} publicaciones de esta campaña se quedarán sin campaña. ¿Eliminarla?`
      : '¿Eliminar esta campaña?';
    if (!confirm(aviso)) return;
    if (await onDelete(campaign.id)) onOpenChange(false);
  };

  const title = readOnly ? 'Campaña' : isEditing ? 'Editar campaña' : 'Nueva campaña';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'Solo un administrador puede cambiarla.'
              : 'Una campaña o fecha clave se ve como una franja en el calendario.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* En solo lectura los campos se ven a opacidad normal: hay que poder leerlos bien. */}
            <fieldset
              disabled={readOnly}
              className="space-y-4 [&_:disabled]:!cursor-default [&_:disabled]:!opacity-100"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Black Friday 2026" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="campaign">Campaña</SelectItem>
                        <SelectItem value="key_date">Fecha clave</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="starts_on"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Desde *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ends_on"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hasta *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {CAMPAIGN_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Color ${c}`}
                          aria-pressed={field.value === c}
                          onClick={() => field.onChange(field.value === c ? '' : c)}
                          className={cn(
                            'h-7 w-7 rounded-full border-2 border-transparent',
                            field.value === c && 'border-foreground ring-2 ring-offset-2 ring-offset-background',
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="goal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Objetivo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: vender 300 pares y +500 seguidores" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea rows={3} className="resize-none" placeholder="Descuentos, productos, ideas…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>

            {readOnly ? (
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cerrar
                </Button>
              </DialogFooter>
            ) : (
              <DialogFooter className="gap-2 sm:gap-2">
                {isEditing && onDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isSubmitting}
                    className="mr-auto"
                  >
                    Eliminar
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Guardando...' : isEditing ? 'Guardar' : 'Crear'}
                </Button>
              </DialogFooter>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
