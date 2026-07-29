import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBusiness } from '@/contexts/BusinessContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, ChevronRight, Plus, Crown, Shield, User } from 'lucide-react';
import type { AppRole } from '@/types/database';
import { usePageMeta } from '@/hooks/usePageMeta';

const ROLE_CONFIG: Record<AppRole, { label: string; icon: typeof Crown; color: string }> = {
  owner: { label: 'Propietario', icon: Crown, color: 'bg-amber-500/10 text-amber-600' },
  admin: { label: 'Administrador', icon: Shield, color: 'bg-blue-500/10 text-blue-600' },
  staff: { label: 'Personal', icon: User, color: 'bg-gray-500/10 text-gray-600' },
};

export default function SelectBusiness() {
  usePageMeta({
    title: 'Selecciona un negocio — Pymova',
    description: 'Cambia entre los negocios que gestionas en Pymova y accede al panel del que quieras administrar.',
    path: '/select-business',
  });
  const navigate = useNavigate();
  const { userBusinesses, setActiveBusiness } = useBusiness();

  const handleSelectBusiness = async (businessId: string) => {
    await setActiveBusiness(businessId);
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Selecciona un negocio
          </h1>
          <p className="text-muted-foreground">
            Elige el negocio con el que quieres trabajar
          </p>
        </div>

        {/* Business List */}
        <div className="space-y-3">
          {userBusinesses.map((business, index) => {
            const roleConfig = ROLE_CONFIG[business.role];
            const RoleIcon = roleConfig.icon;

            return (
              <motion.div
                key={business.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <Card 
                  className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
                  onClick={() => handleSelectBusiness(business.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Logo/Avatar */}
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {business.logo_url ? (
                          <img 
                            src={business.logo_url} 
                            alt={business.name}
                            className="w-full h-full rounded-lg object-cover"
                          />
                        ) : (
                          <Building2 className="w-6 h-6 text-primary" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">
                          {business.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className={roleConfig.color}>
                            <RoleIcon className="w-3 h-3 mr-1" />
                            {roleConfig.label}
                          </Badge>
                          {business.industry && (
                            <span className="text-xs text-muted-foreground">
                              {business.industry}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Arrow */}
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Create new business */}
        <div className="mt-6 text-center">
          <Button 
            variant="outline" 
            onClick={() => navigate('/onboarding')}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Crear nuevo negocio
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
