import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

const INDUSTRIES = [
  { value: 'retail', label: 'Comercio minorista' },
  { value: 'services', label: 'Servicios profesionales' },
  { value: 'food', label: 'Alimentos y bebidas' },
  { value: 'technology', label: 'Tecnología' },
  { value: 'health', label: 'Salud' },
  { value: 'education', label: 'Educación' },
  { value: 'construction', label: 'Construcción' },
  { value: 'manufacturing', label: 'Manufactura' },
  { value: 'other', label: 'Otro' },
];

const CURRENCIES = [
  { value: 'MXN', label: 'Peso Mexicano (MXN)' },
  { value: 'USD', label: 'Dólar Estadounidense (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
];

const TIMEZONES = [
  { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
  { value: 'America/Cancun', label: 'Cancún (GMT-5)' },
  { value: 'America/Tijuana', label: 'Tijuana (GMT-8)' },
  { value: 'America/New_York', label: 'Nueva York (GMT-5)' },
  { value: 'America/Los_Angeles', label: 'Los Ángeles (GMT-8)' },
  { value: 'Europe/Madrid', label: 'Madrid (GMT+1)' },
];

const businessSchema = z.object({
  name: z.string().min(2, 'Nombre requerido').max(100, 'Máximo 100 caracteres'),
  legal_name: z.string().max(150, 'Máximo 150 caracteres').optional().or(z.literal('')),
  tax_id: z.string().max(30, 'Máximo 30 caracteres').optional().or(z.literal('')),
  trade_name: z.string().max(100, 'Máximo 100 caracteres').optional().or(z.literal('')),
  industry: z.string().optional(),
  currency: z.string(),
  timezone: z.string(),
  logo_url: z.string().url('URL inválida').optional().or(z.literal('')),
});

type BusinessFormData = z.infer<typeof businessSchema>;

export function BusinessSettings() {
  const { activeBusiness, refreshBusinesses } = useBusiness();
  const { isAdmin } = useRoleAccess('admin');
  const [isUpdating, setIsUpdating] = useState(false);

  const form = useForm<BusinessFormData>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: '',
      legal_name: '',
      tax_id: '',
      trade_name: '',
      industry: '',
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      logo_url: '',
    },
  });

  // Populate form when business loads
  useEffect(() => {
    if (activeBusiness) {
      form.reset({
        name: activeBusiness.name || '',
        legal_name: activeBusiness.legal_name || '',
        tax_id: activeBusiness.tax_id || '',
        trade_name: activeBusiness.trade_name || '',
        industry: activeBusiness.industry || '',
        currency: activeBusiness.currency || 'MXN',
        timezone: activeBusiness.timezone || 'America/Mexico_City',
        logo_url: activeBusiness.logo_url || '',
      });
    }
  }, [activeBusiness, form]);


  const onSubmit = async (data: BusinessFormData) => {
    if (!activeBusiness || !isAdmin) return;

    setIsUpdating(true);
    try {
      // `.select()` nos permite confirmar que la fila realmente se actualizó
      // (si RLS bloquea el update, Supabase no devuelve error pero tampoco filas).
      const { data: updated, error } = await supabase
        .from('businesses')
        .update({
          name: data.name.trim(),
          legal_name: data.legal_name?.trim() || null,
          tax_id: data.tax_id?.trim().toUpperCase() || null,
          trade_name: data.trade_name?.trim() || null,
          industry: data.industry || null,
          currency: data.currency,
          timezone: data.timezone,
          logo_url: data.logo_url?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeBusiness.id)
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('Error updating business:', error);
        toast.error('Error al guardar negocio', { description: error.message });
        return;
      }

      if (!updated) {
        toast.error('No se guardaron los cambios', {
          description: 'No tienes permisos para editar este negocio.',
        });
        return;
      }

      await refreshBusinesses();
      form.reset(data, { keepValues: true });
      toast.success('Negocio actualizado', { description: 'Los cambios se han guardado.' });
    } catch (err) {
      console.error('Error updating business:', err);
      toast.error('Error al guardar negocio');
    } finally {
      setIsUpdating(false);
    }
  };


  const watchedLogoUrl = form.watch('logo_url');
  const watchedName = form.watch('name');

  if (!activeBusiness) {
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
          <Building2 className="h-5 w-5" />
          Mi Negocio
        </CardTitle>
        <CardDescription>
          Información y configuración del negocio activo
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isAdmin && (
          <Alert className="mb-6">
            <AlertDescription>
              Solo los propietarios y administradores pueden editar la información del negocio.
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Logo Preview */}
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={watchedLogoUrl || undefined} alt={watchedName} />
                <AvatarFallback className="text-lg bg-primary/10 text-primary">
                  <Building2 className="h-8 w-8" />
                </AvatarFallback>
              </Avatar>
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {activeBusiness.trade_name || activeBusiness.name}
                </p>
                {activeBusiness.legal_name && <p>{activeBusiness.legal_name}</p>}
                {activeBusiness.tax_id && <p>CIF: {activeBusiness.tax_id}</p>}
                <p>ID: {activeBusiness.id.slice(0, 8)}...</p>
              </div>

            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del negocio (interno) *</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Nombre de tu empresa" 
                      {...field} 
                      disabled={!isAdmin}
                    />
                  </FormControl>
                  <FormDescription>
                    Cómo identificas este negocio dentro de Pymova.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="legal_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Razón social (nombre legal)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Codiarch Squad S.L."
                        {...field}
                        disabled={!isAdmin}
                      />
                    </FormControl>
                    <FormDescription>
                      Aparecerá en facturas y documentos legales.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tax_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CIF / NIF</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="B12345678"
                        {...field}
                        disabled={!isAdmin}
                      />
                    </FormControl>
                    <FormDescription>Identificación fiscal de la empresa.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="trade_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre comercial (marca)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="TUILUS"
                      {...field}
                      disabled={!isAdmin}
                    />
                  </FormControl>
                  <FormDescription>
                    La marca que ven tus clientes en tickets, presupuestos y comunicaciones.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />


            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industria</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value}
                      disabled={!isAdmin}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona una industria" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INDUSTRIES.map((industry) => (
                          <SelectItem key={industry.value} value={industry.value}>
                            {industry.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value}
                      disabled={!isAdmin}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona moneda" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((currency) => (
                          <SelectItem key={currency.value} value={currency.value}>
                            {currency.label}
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
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zona horaria</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value}
                    disabled={!isAdmin}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona zona horaria" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="logo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL del logo (opcional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://ejemplo.com/logo.png" 
                      {...field} 
                      disabled={!isAdmin}
                    />
                  </FormControl>
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
