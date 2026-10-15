import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusiness } from '@/contexts/BusinessContext';

interface RequireBusinessProps {
  children: ReactNode;
}

export function RequireBusiness({ children }: RequireBusinessProps) {
  const { 
    user, 
    isAuthLoading, 
    isBusinessesLoading,
    activeBusinessId, 
    userBusinesses 
  } = useBusiness();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthLoading || isBusinessesLoading) return;
    if (!user) return; // RequireAuth handles this

    // User has no businesses -> onboarding
    if (userBusinesses.length === 0) {
      navigate('/onboarding', { replace: true });
      return;
    }

    // User has businesses but none selected -> select business
    if (!activeBusinessId && userBusinesses.length > 1) {
      navigate('/select-business', { replace: true });
      return;
    }
  }, [user, isAuthLoading, isBusinessesLoading, activeBusinessId, userBusinesses, navigate]);

  // Still loading or redirecting
  if (isAuthLoading || isBusinessesLoading || userBusinesses.length === 0 || (!activeBusinessId && userBusinesses.length > 1)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return <>{children}</>;
}
