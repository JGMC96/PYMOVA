import { useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import type { PermissionType } from '@/types/database';
import { usePermissions } from '@/hooks/usePermissions';

const schema = z
  .object({
    permission_type: z.enum(['late_arrival', 'early_departure', 'personal_errand', 'other']),
    custom_type_label: z.string().optional(),
    permission_date: z.string().min(1, 'Requerido'),
    start_time: z.string().min(1, 'Requerido'),
    end_time: z.string().min(1, 'Requerido'),
    reason: z.string().optional(),
  })
  .refine((d) => d.end_time > d.start_time, {
    message: 'La hora fin debe ser posterior a la inicio',
    path: ['end_time'],
  })
  .refine((d) => d.permission_type !== 'other' || !!d.custom_type_label?.trim(), {
    message: 'Indica el tipo personalizado',
    path: ['custom_type_label'],
  });

type FormData = z.infer<typeof schema>;

export function PermissionRequestDialog() {
  const [open, setOpen] = useState(false);
  const { createPermission } = usePermissions({ scope: 'mine' });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      permission_type: 'late_arrival',
      custom_type_label: '',
      permission_date: new Date().toISOString().slice(0, 10),
      start_time: '09:00',
      end_time: '10:00',
      reason: '',
    },
  });

  const watchType = form.watch('permission_type');

  const onSubmit = async (data: FormData) => {
    const ok = await createPermission({
      permission_type: data.permission_type as PermissionType,
      custom_type_label: data.custom_type_label,
      permission_date: data.permission_date,
      start_time: data.start_time,
      end_time: data.end_time,
      reason: data.reason,
    });
    if (ok) {
      setOpen(false);
      form.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Nuevo permiso
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar permiso</DialogTitle>
          <DialogDescription>Indica el tramo horario afectado. Quedará pendiente de aprobación.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="permission_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="late_arrival">Llegada tarde</SelectItem>
                      <SelectItem value="early_departure">Salida anticipada</SelectItem>
                      <SelectItem value="personal_errand">Gestión personal</SelectItem>
                      <SelectItem value="other">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchType === 'other' && (
              <FormField
                control={form.control}
                name="custom_type_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción del tipo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Cita médica, trámite..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="permission_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Desde</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hasta</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Enviar solicitud
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
