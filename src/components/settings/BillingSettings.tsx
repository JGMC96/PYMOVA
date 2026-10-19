import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Receipt, Loader2 } from 'lucide-react';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DEFAULT_TAX_RATE } from '@/lib/tax';

const billingSchema = z.object({
  invoice_prefix: z.string().max(10, 'Máximo 10 caracteres'),
  tax_rate: z.coerce.number().min(0, 'Mínimo 0%').max(100, 'Máximo 100%'),
});

type BillingFormData = z.infer<typeof billingSchema>;

export function BillingSettings() {
  const { settings, isLoading, updateSettings, isUpdating } = useBusinessSettings();
  const { isAdmin } = useRoleAccess('admin');

  const form = useForm<BillingFormData>({
    resolver: zodResolver(billingSchema),
    defaultValues: {
      invoice_prefix: 'FAC-',
      tax_rate: DEFAULT_TAX_RATE,
    },
  });

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      form.reset({
        invoice_prefix: settings.invoice_prefix || 'FAC-',
        tax_rate: settings.tax_rate ?? DEFAULT_TAX_RATE,
      });
    }
  }, [settings, form]);

  const onSubmit = async (data: BillingFormData) => {
    if (!isAdmin) return;
    await updateSettings({
      invoice_prefix: data.invoice_prefix,
      tax_rate: data.tax_rate,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Configuración de Facturación
        </CardTitle>
        <CardDescription>
          Prefijo de facturas, numeración y tasa de IVA
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isAdmin && (
          <Alert className="mb-6">
            <AlertDescription>
              Solo los propietarios y administradores pueden editar la configuración de facturación.
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Next Invoice Number (Read-only info) */}
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium">Próximo número de factura</p>
              <p className="text-2xl font-bold text-primary mt-1">
                {settings?.invoice_prefix || 'FAC-'}{settings?.next_invoice_number || 1}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Este número se incrementa automáticamente al crear cada factura
              </p>
            </div>

            <FormField
              control={form.control}
              name="invoice_prefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prefijo de factura</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="FAC-" 
                      {...field} 
                      disabled={!isAdmin}
                      maxLength={10}
                    />
                  </FormControl>
                  <FormDescription>
                    Se añade antes del número de factura (ej: FAC-001)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tax_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tasa de IVA (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="21"
                      {...field}
                      disabled={!isAdmin}
                      min={0}
                      max={100}
                      step={0.01}
                    />
                  </FormControl>
                  <FormDescription>
                    Los precios del catálogo ya incluyen el IVA. Este tipo se usa para desglosar la base imponible en tickets y facturas.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isAdmin && (
              <div className="flex justify-end">
                <Button type="submit" disabled={isUpdating}>
                  {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar cambios
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
