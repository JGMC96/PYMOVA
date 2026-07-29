import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2, Sparkles, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

const INDUSTRIES = [
  { value: 'retail', label: 'Comercio / Retail' },
  { value: 'services', label: 'Servicios profesionales' },
  { value: 'consulting', label: 'Consultoría' },
  { value: 'technology', label: 'Tecnología' },
  { value: 'healthcare', label: 'Salud' },
  { value: 'education', label: 'Educación' },
  { value: 'food', label: 'Alimentos y bebidas' },
  { value: 'construction', label: 'Construcción' },
  { value: 'manufacturing', label: 'Manufactura' },
  { value: 'other', label: 'Otro' },
];

export default function Onboarding() {
  usePageMeta({
    title: 'Configura tu negocio — Pymova',
    description: 'Da de alta tu negocio en Pymova en un minuto: nombre, sector, moneda y zona horaria para empezar a facturar y vender.',
    path: '/onboarding',
  });
  const navigate = useNavigate();
  const { user, refreshBusinesses } = useBusiness();
  const { isSuperAdmin } = useSuperAdmin();
  const [isLoading, setIsLoading] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast.error('Debes iniciar sesión');
      navigate('/auth');
      return;
    }

    if (!businessName.trim()) {
      toast.error('El nombre del negocio es requerido');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Create the business
      const slug = generateSlug(businessName);
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .insert({
          name: businessName.trim(),
          slug: slug,
          industry: industry || null,
        })
        .select()
        .single();

      if (businessError) throw businessError;

      // 2. Add user as owner
      const { error: memberError } = await supabase
        .from('business_members')
        .insert({
          business_id: business.id,
          user_id: user.id,
          role: 'owner',
          is_active: true,
          joined_at: new Date().toISOString(),
        });

      if (memberError) throw memberError;

      // 3. Get trial plan from plans table
      const { data: trialPlan, error: planError } = await supabase
        .from('plans')
        .select('id')
        .eq('key', 'trial')
        .single();

      if (planError) throw planError;

      // 4. Create trial subscription with plan_id FK
      const { error: subError } = await supabase
        .from('subscriptions')
        .insert({
          business_id: business.id,
          plan_id: trialPlan.id,
          status: 'trialing',
        });

      if (subError) throw subError;

      // 5. Get modules included in trial plan from plan_modules
      const { data: planModules, error: planModulesError } = await supabase
        .from('plan_modules')
        .select('module_id')
        .eq('plan_id', trialPlan.id);

      if (planModulesError) throw planModulesError;

      // 6. Enable modules for the business using module_id FK
      if (planModules && planModules.length > 0) {
        const moduleInserts = planModules.map((pm) => ({
          business_id: business.id,
          module_id: pm.module_id,
          is_enabled: true,
        }));

        const { error: modulesError } = await supabase
          .from('business_modules')
          .insert(moduleInserts);

        if (modulesError) throw modulesError;
      }

      // 7. Create business settings
      const { error: settingsError } = await supabase
        .from('business_settings')
        .insert({
          business_id: business.id,
          next_invoice_number: 1,
          invoice_prefix: 'FAC-',
          tax_rate: 16.00,
        });

      if (settingsError) throw settingsError;

      // 8. Set this as the active business in profile
      await supabase.rpc('set_active_business', { _business_id: business.id });

      // 9. Refresh context and navigate
      await refreshBusinesses();
      toast.success('¡Negocio creado exitosamente!');
      navigate('/dashboard');
    } catch (error: unknown) {
      console.error('Error creating business:', error);
      const message = error instanceof Error ? error.message : 'Error al crear el negocio';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Configura tu negocio en Pymova
          </h1>
          <p className="text-muted-foreground">
            Configura tu primer negocio para comenzar
          </p>
        </div>

        {/* Super admin shortcut */}
        {isSuperAdmin && (
          <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 p-4">
              <div className="flex items-start gap-3 flex-1">
                <ShieldCheck className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-sm">
                    Eres Super Admin de la plataforma
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Puedes saltarte este paso y administrar todos los negocios desde el panel global.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/admin')}
                className="border-amber-500/40 hover:bg-amber-500/10"
              >
                Ir al panel Super Admin
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Form Card */}
        <Card className="border-border/50 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Información del negocio
            </CardTitle>
            <CardDescription>
              Esta información te ayudará a personalizar tu experiencia
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="businessName">Nombre del negocio *</Label>
                <Input
                  id="businessName"
                  placeholder="Ej: Mi Empresa S.A. de C.V."
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industria</Label>
                <Select value={industry} onValueChange={setIndustry} disabled={isLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una industria" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind.value} value={ind.value}>
                        {ind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Trial info */}
              <div className="bg-accent/50 rounded-lg p-4 border border-accent">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Prueba gratuita de 14 días</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Acceso completo a clientes, productos, facturación y pagos. Sin tarjeta de crédito.
                    </p>
                  </div>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creando negocio...
                  </>
                ) : (
                  <>
                    Crear negocio
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
