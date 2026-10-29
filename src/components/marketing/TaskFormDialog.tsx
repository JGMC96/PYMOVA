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
import type { MarketingCampaign, MarketingPost, MarketingTask } from '@/types/database';
import type { TeamMember } from '@/hooks/useMarketingPosts';
import type { TaskFormData } from '@/hooks/useMarketingTasks';

const schema = z.object({
  title: z.string().trim().min(1, 'Escribe qué hay que hacer').max(200),
  notes: z.string().max(2000).optional(),
  assignee_id: z.string().optional(),
  due_on: z.string().optional(),
  campaign_id: z.string().optional(),
  post_id: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: MarketingTask | null;
  teamMembers: TeamMember[];
  campaigns: MarketingCampaign[];
  posts: MarketingPost[];
  onSubmit: (data: TaskFormData) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  readOnly?: boolean;
}

const EMPTY: FormValues = { title: '', notes: '', assignee_id: '', due_on: '', campaign_id: '', post_id: '' };

/** Selector con opción «Ninguno/a» (Radix Select no admite el valor vacío). */
function OptionalSelect({
  value,
  onChange,
  none,
  options,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  none: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <FormControl>
        <SelectTrigger>
          <SelectValue placeholder={none} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        <SelectItem value="none">{none}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  teamMembers,
  campaigns,
  posts,
  onSubmit,
  onDelete,
  readOnly = false,
}: TaskFormDialogProps) {
  const isEditing = !!task;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(
      task
        ? {
            title: task.title,
            notes: task.notes ?? '',
            assignee_id: task.assignee_id ?? '',
            due_on: task.due_on ?? '',
            campaign_id: task.campaign_id ?? '',
            post_id: task.post_id ?? '',
          }
        : EMPTY,
    );
  }, [open, task, form]);

  const handleSubmit = async (v: FormValues) => {
    const ok = await onSubmit({
      title: v.title,
      notes: v.notes,
      assignee_id: v.assignee_id || null,
      due_on: v.due_on || null,
      campaign_id: v.campaign_id || null,
      post_id: v.post_id || null,
    });
    if (ok) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!task || !onDelete) return;
    if (!confirm('¿Eliminar esta tarea?')) return;
    if (await onDelete(task.id)) onOpenChange(false);
  };

  const title = readOnly ? 'Tarea' : isEditing ? 'Editar tarea' : 'Nueva tarea';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'Solo un administrador puede cambiarla. Si es tuya, márcala como hecha en la lista.'
              : 'Quién lo hace y para cuándo. La persona responsable la marca como hecha.'}
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
                    <FormLabel>Tarea *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Grabar el reel de los zuecos" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="assignee_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsable</FormLabel>
                      <OptionalSelect
                        value={field.value}
                        onChange={field.onChange}
                        none="Sin asignar"
                        options={teamMembers.map((m) => ({ value: m.user_id, label: m.full_name || 'Sin nombre' }))}
                      />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="due_on"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Para el día</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="campaign_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Campaña</FormLabel>
                      <OptionalSelect
                        value={field.value}
                        onChange={field.onChange}
                        none="Ninguna"
                        options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                      />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="post_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Publicación</FormLabel>
                      <OptionalSelect
                        value={field.value}
                        onChange={field.onChange}
                        none="Ninguna"
                        options={posts.map((p) => ({ value: p.id, label: p.title }))}
                      />
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
                      <Textarea rows={3} className="resize-none" {...field} />
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
