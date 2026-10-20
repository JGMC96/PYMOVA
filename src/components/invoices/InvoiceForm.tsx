import { useMemo } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, CalendarIcon } from 'lucide-react';
import { round2, taxBreakdown } from '@/lib/tax';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { InvoiceLineItem } from './InvoiceLineItem';
import type { Client, Product } from '@/types/database';
import type { InvoiceItemInput } from '@/hooks/useInvoices';
import { cn } from '@/lib/utils';
import { useMoney } from '@/hooks/useMoney';

const invoiceSchema = z.object({
  client_id: z.string().min(1, 'Selecciona un cliente'),
  due_date: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().optional(),
        description: z.string().min(1, 'La descripción es requerida'),
        quantity: z.coerce.number().positive('Cantidad debe ser mayor a 0'),
        unit_price: z.coerce.number().min(0, 'Precio debe ser mayor o igual a 0'),
      })
    )
    .min(1, 'Agrega al menos una línea'),
});

type InvoiceFormValues = z.infer<typeof invoiceSchema>;

interface InvoiceFormProps {
  invoiceNumber: string;
  clients: Client[];
  products: Product[];
  taxRate: number;
  isLoading: boolean;
  onSubmit: (data: {
    client_id: string;
    due_date?: string;
    notes?: string;
    items: InvoiceItemInput[];
  }) => void;
  onCancel: () => void;
}

export function InvoiceForm({
  invoiceNumber,
  clients,
  products,
  taxRate,
  isLoading,
  onSubmit,
  onCancel,
}: InvoiceFormProps) {
  const { format: formatPrice } = useMoney();
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      client_id: '',
      due_date: undefined,
      notes: '',
      items: [
        {
          product_id: undefined,
          description: '',
          quantity: 1,
          unit_price: 0,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  // Watch items for real-time calculation
  const watchedItems = useWatch({
    control: form.control,
    name: 'items',
  });

  // Totales: los precios incluyen el IVA; la base y la cuota se deducen del total
  // (mismo cálculo que create_invoice_with_items en el servidor).
  const calculations = useMemo(() => {
    const total = round2(
      (watchedItems || []).reduce((sum, item) => {
        const qty = Number(item?.quantity) || 0;
        const price = Number(item?.unit_price) || 0;
        return sum + round2(qty * price);
      }, 0),
    );
    const { base: subtotal, tax } = taxBreakdown(total, taxRate);
    return { subtotal, tax, total };
  }, [watchedItems, taxRate]);

  const handleSubmit = (values: InvoiceFormValues) => {
    onSubmit({
      client_id: values.client_id,
      due_date: values.due_date,
      notes: values.notes,
      items: values.items.map((item) => ({
        product_id: item.product_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    });
  };

  const addLine = () => {
    append({
      product_id: undefined,
      description: '',
      quantity: 1,
      unit_price: 0,
    });
  };

  // Filter only active clients
  const activeClients = clients.filter((c) => c.is_active);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Header info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Información de Factura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Invoice Number (readonly) */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FormLabel>Número de Factura</FormLabel>
                <Input value={invoiceNumber} disabled className="bg-muted" />
              </div>

              {/* Client selector */}
              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un cliente" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeClients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                            {client.company && ` (${client.company})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Due date */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de Vencimiento</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(new Date(field.value), 'PPP', { locale: es })
                            ) : (
                              <span>Selecciona una fecha</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value ? new Date(field.value) : undefined}
                          onSelect={(date) =>
                            field.onChange(date ? format(date, 'yyyy-MM-dd') : undefined)
                          }
                          disabled={(date) => date < new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Líneas de Factura</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar línea
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
              <div className="col-span-3">Producto</div>
              <div className="col-span-3">Descripción</div>
              <div className="col-span-2">Cantidad</div>
              <div className="col-span-2">Precio</div>
              <div className="col-span-1 text-right">Total</div>
              <div className="col-span-1"></div>
            </div>

            <Separator />

            {/* Line items */}
            {fields.map((field, index) => (
              <InvoiceLineItem
                key={field.id}
                index={index}
                control={form.control as any}
                products={products}
                onRemove={() => remove(index)}
                canRemove={fields.length > 1}
              />
            ))}

            {form.formState.errors.items?.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.items.root.message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Totals */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-end space-y-2">
              <div className="flex justify-between w-64">
                <span className="text-muted-foreground">Base imponible:</span>
                <span className="font-medium">{formatPrice(calculations.subtotal)}</span>
              </div>
              <div className="flex justify-between w-64">
                <span className="text-muted-foreground">IVA ({taxRate}%) incluido:</span>
                <span className="font-medium">{formatPrice(calculations.tax)}</span>
              </div>
              <Separator className="w-64" />
              <div className="flex justify-between w-64">
                <span className="font-semibold">Total:</span>
                <span className="font-bold text-lg">{formatPrice(calculations.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Notas adicionales para la factura (opcional)"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Guardando...' : 'Guardar Factura'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
