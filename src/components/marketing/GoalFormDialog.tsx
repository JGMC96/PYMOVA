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
import { GOAL_METRIC_LABEL } from '@/lib/marketingPlan';
import type { MarketingCampaign, MarketingGoal, MarketingGoalMetric } from '@/types/database';
import type { GoalFormData } from '@/hooks/useMarketingCampaigns';

const METRICS = Object.keys(GOAL_METRIC_LABEL) as MarketingGoalMetric[];

const schema = z
  .object({
    title: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
    metric: z.enum(['sales', 'followers', 'reach', 'engagement', 'email_subscribers', 'other']),
    target: z.coerce.number({ invalid_type_error: 'Pon una cifra' }).positive('La meta tiene que ser mayor que 0'),
    current: z.coerce.number({ invalid_type_error: 'Pon una cifra' }).min(0, 'No puede ser negativo'),
    starts_on: z.string().min(1, 'Pon la fecha de inicio'),
    ends_on: z.string().min(1, 'Pon la fecha de fin'),
    campaign_id: z.string().optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on, {
    message: 'La fecha de fin no puede ser anterior a la de inicio',
    path: ['ends_on'],
  });

type FormValues = z.infer<typeof schema>;

interface GoalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: MarketingGoal | null;
  campaigns: MarketingCampaign[];
  onSubmit: (data: GoalFormData) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  readOnly?: boolean;
}

const EMPTY: FormValues = {
  title: '',
  metric: 'sales',
  target: 0,
  current: 0,
  starts_on: '',
  ends_on: '',
  campaign_id: '',
  notes: '',
};

export function GoalFormDialog({
  open,
  onOpenChange,
  goal,
  campaigns,
  onSubmit,
  onDelete,
  readOnly = false,
}: GoalFormDialogProps) {
  const isEditing = !!goal;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(
      goal
        ? {
            title: goal.title,
            metric: goal.metric,
            target: goal.target,
            current: goal.current,
            starts_on: goal.starts_on,
            ends_on: goal.ends_on,
            campaign_id: goal.campaign_id ?? '',
            notes: goal.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, goal, form]);

  // Al elegir campaña, sus fechas rellenan las del objetivo si están vacías.
  const pickCampaign = (id: string) => {
    form.setValue('campaign_id', id);
    const c = campaigns.find((x) => x.id === id);
    if (!c) return;
    if (!form.getValues('starts_on')) form.setValue('starts_on', c.starts_on);
    if (!form.getValues('ends_on')) form.setValue('ends_on', c.ends_on);
  };

  const handleSubmit = async (v: FormValues) => {
    const ok = await onSubmit({
      title: v.title,
      metric: v.metric,
      target: v.target,
      current: v.current,
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      campaign_id: v.campaign_id || null,
      notes: v.notes,
    });
    if (ok) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!goal || !onDelete) return;
    if (!confirm('¿Eliminar este objetivo?')) return;
    if (await onDelete(goal.id)) onOpenChange(false);
  };

  const title = readOnly ? 'Objetivo' : isEditing ? 'Editar objetivo' : 'Nuevo objetivo';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'Solo un administrador puede cambiarlo.'
              : 'Pon una cifra meta y ve apuntando cómo vais. Más adelante se rellenará sola con las métricas.'}
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
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Objetivo *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Ventas de Black Friday" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="metric"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Qué se mide</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {METRICS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {GOAL_METRIC_LABEL[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="campaign_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Campaña</FormLabel>
                      <Select
                        value={field.value || 'none'}
                        onValueChange={(v) => (v === 'none' ? field.onChange('') : pickCampaign(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Ninguna" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Ninguna</SelectItem>
                          {campaigns.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="target"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meta *</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" min={0} step="any" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="current"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Llevamos</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" min={0} step="any" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea rows={2} className="resize-none" {...field} />
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
