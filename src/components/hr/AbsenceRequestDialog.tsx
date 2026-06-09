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
import type { AbsenceType } from '@/types/database';
import { useAbsences } from '@/hooks/useAbsences';

const schema = z
  .object({
    absence_type: z.enum(['vacation', 'sick_leave', 'personal', 'other']),
    custom_type_label: z.string().optional(),
    start_date: z.string().min(1, 'Requerido'),
    end_date: z.string().min(1, 'Requerido'),
    reason: z.string().optional(),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: 'La fecha fin debe ser igual o posterior a la fecha inicio',
    path: ['end_date'],
  })
  .refine((d) => d.absence_type !== 'other' || (d.custom_type_label && d.custom_type_label.trim().length > 0), {
    message: 'Indica el tipo personalizado',
    path: ['custom_type_label'],
  });

type FormData = z.infer<typeof schema>;

export function AbsenceRequestDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const { createAbsence } = useAbsences({ scope: 'mine' });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      absence_type: 'vacation',
      custom_type_label: '',
      start_date: '',
      end_date: '',
      reason: '',
    },
  });

  const watchType = form.watch('absence_type');

  const onSubmit = async (data: FormData) => {
    const ok = await createAbsence({
      absence_type: data.absence_type as AbsenceType,
      custom_type_label: data.custom_type_label,
      start_date: data.start_date,
      end_date: data.end_date,
      reason: data.reason,
    });
    if (ok) {
      setOpen(false);
      form.reset();
      onCreated?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Nueva solicitud
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar ausencia</DialogTitle>
          <DialogDescription>Tu solicitud quedará pendiente de aprobación.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="absence_type"
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
                      <SelectItem value="vacation">Vacaciones</SelectItem>
                      <SelectItem value="sick_leave">Baja médica</SelectItem>
                      <SelectItem value="personal">Asuntos propios</SelectItem>
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
                      <Input placeholder="Ej: Mudanza, matrimonio..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Desde</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hasta</FormLabel>
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
