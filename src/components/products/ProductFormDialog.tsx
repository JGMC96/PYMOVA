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
import type { Product } from '@/types/database';
import type { ProductFormData } from '@/hooks/useProducts';

const productSchema = z.object({
  name: z.string()
    .min(1, 'El nombre es requerido')
    .min(2, 'El nombre debe tener al menos 2 caracteres'),
  price: z.coerce.number()
    .min(0, 'El precio debe ser mayor o igual a 0'),
  cost_price: z.union([z.literal(''), z.coerce.number().min(0, 'El coste debe ser mayor o igual a 0')])
    .optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSubmit: (data: ProductFormData) => Promise<boolean>;
  isSubmitting: boolean;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSubmit,
  isSubmitting,
}: ProductFormDialogProps) {
  const isEditing = !!product;

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      price: 0,
      cost_price: '',
      category: '',
      unit: '',
      description: '',
    },
  });

  // Reset form when dialog opens/closes or product changes
  useEffect(() => {
    if (open) {
      if (product) {
        form.reset({
          name: product.name,
          price: product.price,
          cost_price: product.cost_price ?? '',
          category: product.category || '',
          unit: product.unit || '',
          description: product.description || '',
        });
      } else {
        form.reset({
          name: '',
          price: 0,
          cost_price: '',
          category: '',
          unit: '',
          description: '',
        });
      }
    }
  }, [open, product, form]);

  const handleSubmit = async (values: ProductFormValues) => {
    const success = await onSubmit({
      name: values.name,
      price: values.price,
      cost_price: values.cost_price === '' || values.cost_price === undefined ? null : Number(values.cost_price),
      category: values.category || undefined,
      unit: values.unit || undefined,
      description: values.description || undefined,
    });

    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar producto' : 'Nuevo producto'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modifica los datos del producto.'
              : 'Agrega un nuevo producto o servicio al catálogo.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio *</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01"
                        min="0"
                        placeholder="0.00" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad</FormLabel>
                    <FormControl>
                      <Input placeholder="ej: pieza, kg, hora" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <FormControl>
                    <Input placeholder="ej: Electrónica, Servicios" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Descripción opcional del producto..."
                      className="resize-none"
                      rows={3}
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear producto'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
