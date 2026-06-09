import { ReactNode } from 'react';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import type { ModuleKey } from '@/types/database';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RequireModuleProps {
  module: ModuleKey;
  children: ReactNode;
  fallback?: ReactNode;
}

const MODULE_NAMES: Record<ModuleKey, string> = {
  clients: 'Clientes',
  products: 'Productos',
  invoicing: 'Facturación',
  payments: 'Pagos',
  ai_advisor: 'Asesor IA',
  reports: 'Reportes',
  retail: 'Retail',
  marketing: 'Marketing',
  hr: 'Recursos Humanos',
};

export function RequireModule({ module, children, fallback }: RequireModuleProps) {
  const { hasAccess, isLoading } = useModuleAccess(module);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!hasAccess) {
    if (fallback) return <>{fallback}</>;

    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <CardTitle>Módulo no disponible</CardTitle>
          <CardDescription>
            El módulo de <strong>{MODULE_NAMES[module]}</strong> no está habilitado en tu plan actual.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button variant="default">
            Mejorar plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
