// Configuración › Mi Perfil › Verificación en dos pasos: activarla con una app de
// autenticación (Google Authenticator, Microsoft Authenticator, 1Password…) o quitarla.
// Con ella activada, el servidor pide el código además de la contraseña (0049).
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cleanTotpCode, listTotpFactors, verifyTotp, type TotpFactor } from '@/lib/mfa';

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

/** El QR llega como SVG; según la versión, ya como data URL o sin el prefijo. */
const qrSrc = (qr: string) => (qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`);

export function TwoFactorSettings() {
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFactors(await listTotpFactors());
    } catch (e) {
      setError((e as Error).message);
      setFactors([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verified = factors?.find((f) => f.status === 'verified') ?? null;

  const start = async () => {
    setBusy(true);
    setError(null);
    // Un alta anterior a medias impediría crear otra con el mismo nombre.
    for (const f of factors ?? []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `PYMOVA ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? 'No se pudo empezar la activación.');
      return;
    }
    setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode('');
  };

  const cancel = async () => {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setError(null);
    await load();
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment || code.length !== 6) return;
    setBusy(true);
    setError(null);
    const result = await verifyTotp(enrollment.factorId, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setCode('');
      return;
    }
    setEnrollment(null);
    toast.success('Verificación en dos pasos activada. Te pediremos el código al iniciar sesión.');
    await load();
  };

  const disable = async () => {
    if (!verified) return;
    setBusy(true);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (unenrollError) {
      toast.error(`No se pudo desactivar: ${unenrollError.message}`);
      return;
    }
    toast.success('Verificación en dos pasos desactivada.');
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Verificación en dos pasos
          {verified && <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Activada</Badge>}
        </CardTitle>
        <CardDescription>
          Además de la contraseña, al entrar se pide un código de 6 cifras de una app del móvil (Google
          Authenticator, Microsoft Authenticator, 1Password…). Así una contraseña robada no basta para entrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {factors === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : enrollment ? (
          <form onSubmit={confirm} className="space-y-4">
            <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Abre la app de autenticación del móvil y añade una cuenta nueva.</li>
              <li>Escanea este código QR (o escribe la clave a mano).</li>
              <li>Escribe aquí el código de 6 cifras que te muestra la app.</li>
            </ol>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              <img src={qrSrc(enrollment.qr)} alt="Código QR para la app de autenticación" className="h-44 w-44 rounded-md bg-white p-2" />
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">Clave para escribirla a mano:</p>
                <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{enrollment.secret}</code>
              </div>
            </div>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="mfa-enroll-code">Código de la app</Label>
              <Input
                id="mfa-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(cleanTotpCode(e.target.value))}
                className="text-center tracking-[0.4em]"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Activar
              </Button>
              <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : verified ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                <ShieldOff className="mr-2 h-4 w-4" />
                Desactivar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Desactivar la verificación en dos pasos?</AlertDialogTitle>
                <AlertDialogDescription>
                  A partir de ahora bastará con la contraseña para entrar en tu cuenta.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void disable()}>Desactivar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={() => void start()} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activar la verificación en dos pasos
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
