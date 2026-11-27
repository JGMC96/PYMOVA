import { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCanSeeSales } from '@/hooks/useSalesAccess';

/** Solo el propietario y quien tenga «Ver ventas». La seguridad real está en las RPC. */
export function RequireSalesAccess({ children }: { children: ReactNode }) {
  const { canSeeSales, isLoading } = useCanSeeSales();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!canSeeSales) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Para ver las ventas necesitas el permiso <strong>Ver ventas</strong>. Lo concede el propietario del negocio.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <>{children}</>;
}
