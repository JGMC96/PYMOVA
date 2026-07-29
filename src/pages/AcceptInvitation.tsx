import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { setPendingInvite, clearPendingInvite } from '@/lib/inviteLink';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const AcceptInvitation = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isAuthLoading, refreshBusinesses, setActiveBusiness } = useBusiness();
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isAuthLoading || !token) return;

    if (!user) {
      setPendingInvite(token);
      navigate('/auth?invite=1', { replace: true });
      return;
    }

    let cancelled = false;

    const accept = async () => {
      setStatus('working');
      const { data, error } = await supabase.rpc('accept_business_invitation', { _token: token });

      if (cancelled) return;

      if (error) {
        clearPendingInvite();
        setStatus('error');
        setMessage(error.message);
        return;
      }

      clearPendingInvite();
      await refreshBusinesses();
      if (data) await setActiveBusiness(data as string);
      setStatus('done');
      setMessage('Te has unido al negocio correctamente.');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    };


    accept();
    return () => {
      cancelled = true;
    };
  }, [token, user, isAuthLoading, navigate, refreshBusinesses, setActiveBusiness]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle asChild>
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Invitación al equipo</h1>
          </CardTitle>
          <CardDescription>Estamos procesando tu invitación</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          {status === 'done' ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p>{message}</p>
            </>
          ) : status === 'error' ? (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-muted-foreground">{message}</p>
              <Button onClick={() => navigate('/dashboard')}>Ir al panel</Button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Validando invitación...</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default AcceptInvitation;
