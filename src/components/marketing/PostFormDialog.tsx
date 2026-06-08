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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MarketingPost, MarketingChannel } from '@/types/database';
import type { MarketingPostFormData, TeamMember } from '@/hooks/useMarketingPosts';
import { CONTENT_TYPE_LABEL, STATUS_LABEL, CHANNEL_LABEL } from './PostBadge';

const schema = z.object({
  title: z.string().trim().min(1, 'El título es requerido').max(200),
  copy: z.string().max(2000).optional(),
  content_type: z.enum(['story', 'post', 'reel']),
  channels: z.array(z.enum(['instagram', 'facebook'])).min(1, 'Selecciona al menos un canal'),
  status: z.enum(['idea', 'draft', 'scheduled', 'published', 'cancelled']),
  scheduled_at: z.string().optional(),
  assignee_id: z.string().optional(),
  reference_url: z
    .string()
    .trim()
    .url('URL inválida')
    .max(500)
    .optional()
    .or(z.literal('')),
  hashtags: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

type FormValues = z.infer<typeof schema>;

interface PostFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post?: MarketingPost | null;
  defaultDate?: Date | null;
  teamMembers: TeamMember[];
  onSubmit: (data: MarketingPostFormData) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  isSubmitting: boolean;
}

// Convert ISO timestamp to <input type="datetime-local"> value
function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

export function PostFormDialog({
  open,
  onOpenChange,
  post,
  defaultDate,
  teamMembers,
  onSubmit,
  onDelete,
  isSubmitting,
}: PostFormDialogProps) {
  const isEditing = !!post;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      copy: '',
      content_type: 'post',
      channels: ['instagram'],
      status: 'idea',
      scheduled_at: '',
      assignee_id: '',
      reference_url: '',
      hashtags: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    if (post) {
      form.reset({
        title: post.title,
        copy: post.copy ?? '',
        content_type: post.content_type,
        channels: post.channels,
        status: post.status,
        scheduled_at: toLocalInputValue(post.scheduled_at),
        assignee_id: post.assignee_id ?? '',
        reference_url: post.reference_url ?? '',
        hashtags: post.hashtags ?? '',
        notes: post.notes ?? '',
      });
    } else {
      const baseDate = defaultDate ?? null;
      const scheduled = baseDate ? toLocalInputValue(baseDate.toISOString()) : '';
      form.reset({
        title: '',
        copy: '',
        content_type: 'post',
        channels: ['instagram'],
        status: 'idea',
        scheduled_at: scheduled,
        assignee_id: '',
        reference_url: '',
        hashtags: '',
        notes: '',
      });
    }
  }, [open, post, defaultDate, form]);

  const handleSubmit = async (values: FormValues) => {
    const ok = await onSubmit({
      title: values.title,
      copy: values.copy || undefined,
      content_type: values.content_type,
      channels: values.channels,
      status: values.status,
      scheduled_at: values.scheduled_at ? new Date(values.scheduled_at).toISOString() : null,
      assignee_id: values.assignee_id || null,
      reference_url: values.reference_url || undefined,
      hashtags: values.hashtags || undefined,
      notes: values.notes || undefined,
    });
    if (ok) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!post || !onDelete) return;
    if (!confirm('¿Eliminar esta publicación? Esta acción no se puede deshacer.')) return;
    const ok = await onDelete(post.id);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar publicación' : 'Nueva publicación'}</DialogTitle>
          <DialogDescription>
            Planifica el contenido y compártelo con tu equipo.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Lanzamiento colección verano" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="content_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.keys(CONTENT_TYPE_LABEL) as Array<keyof typeof CONTENT_TYPE_LABEL>).map(
                          (t) => (
                            <SelectItem key={t} value={t}>
                              {CONTENT_TYPE_LABEL[t]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="channels"
              render={() => (
                <FormItem>
                  <FormLabel>Canales *</FormLabel>
                  <div className="flex gap-4">
                    {(Object.keys(CHANNEL_LABEL) as MarketingChannel[]).map((c) => (
                      <FormField
                        key={c}
                        control={form.control}
                        name="channels"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(c)}
                                onCheckedChange={(checked) => {
                                  const next = checked
                                    ? [...(field.value || []), c]
                                    : (field.value || []).filter((v) => v !== c);
                                  field.onChange(next);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">
                              {CHANNEL_LABEL[c]}
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="scheduled_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha y hora</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assignee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsable</FormLabel>
                    <Select
                      value={field.value || 'none'}
                      onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sin asignar</SelectItem>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.full_name || 'Sin nombre'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="copy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Copy</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Texto del post, descripción..."
                      rows={3}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hashtags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hashtags</FormLabel>
                  <FormControl>
                    <Input placeholder="#verano #lanzamiento" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reference_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL de referencia / asset</FormLabel>
                  <FormControl>
                    <Input placeholder="https://drive.google.com/..." {...field} />
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
                  <FormLabel>Notas internas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Briefing, observaciones para el equipo..."
                      rows={2}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : isEditing ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
