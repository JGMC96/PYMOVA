import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useBusiness } from '@/contexts/BusinessContext';
import { MfaChallenge } from '@/components/auth/MfaChallenge';

interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { user, isAuthLoading, mfaPending } = useBusiness();
  const location = useLocation();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Verificación en dos pasos activada y sin el código en esta sesión.
  if (mfaPending) {
    return <MfaChallenge />;
  }

  return <>{children}</>;
}
