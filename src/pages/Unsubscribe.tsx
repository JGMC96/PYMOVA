import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, MailX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type State = 'loading' | 'valid' | 'invalid' | 'already' | 'done' | 'error';

const Unsubscribe = () => {
  const [state, setState] = useState<State>('loading');
  const [submitting, setSubmitting] = useState(false);
  const token = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    const validate = async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
        const res = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string },
        });
        const data = await res.json();
        if (data?.valid) setState('valid');
        else if (data?.reason === 'already_unsubscribed') setState('already');
        else setState('invalid');
      } catch {
        setState('error');
      }
    };
    validate();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', {
      body: { token },
    });
    setSubmitting(false);
    if (error) setState('error');
    else if (data?.success) setState('done');
    else if (data?.reason === 'already_unsubscribed') setState('already');
    else setState('error');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Cancelar suscripción</CardTitle>
          <CardDescription>Gestiona los correos que recibes de Pymova</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          {state === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Comprobando enlace...</p>
            </>
          )}
          {state === 'valid' && (
            <>
              <MailX className="h-10 w-10 text-primary" />
              <p className="text-muted-foreground">
                Confirma que quieres dejar de recibir correos de Pymova.
              </p>
              <Button onClick={confirm} disabled={submitting}>
                {submitting ? 'Procesando...' : 'Confirmar baja'}
              </Button>
            </>
          )}
          {state === 'done' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p>Listo, ya no recibirás más correos.</p>
            </>
          )}
          {state === 'already' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-muted-foreground">Este correo ya estaba dado de baja.</p>
            </>
          )}
          {(state === 'invalid' || state === 'error') && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-muted-foreground">
                El enlace no es válido o ha caducado.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default Unsubscribe;
