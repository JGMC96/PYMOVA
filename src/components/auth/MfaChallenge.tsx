// Pantalla del segundo paso: quien tiene la verificación en dos pasos activada mete aquí el
// código de su app tras la contraseña. Hasta entonces el servidor no le deja ver nada (0049).
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/contexts/BusinessContext';
import { cleanTotpCode, listTotpFactors, verifyTotp } from '@/lib/mfa';

export function MfaChallenge() {
  const { signOut } = useBusiness();
  const navigate = useNavigate();
  const location = useLocation();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    listTotpFactors()
      .then((factors) => setFactorId(factors.find((f) => f.status === 'verified')?.id ?? null))
      .catch((e: Error) => setError(e.message));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.length !== 6) return;
    setIsVerifying(true);
    setError(null);
    const result = await verifyTotp(factorId, code);
    setIsVerifying(false);
    if (!result.ok) {
      setError(result.error);
      setCode('');
      return;
    }
    // Con solo la contraseña no se veían sus negocios y el inicio de sesión pudo mandarle a
    // crear uno: se vuelve a decidir adónde va, ya con el código.
    if (['/onboarding', '/select-business'].includes(location.pathname)) {
      navigate('/auth', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verificación en dos pasos
          </CardTitle>
          <CardDescription>Escribe el código de 6 cifras de tu app de autenticación.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Código</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(cleanTotpCode(e.target.value))}
                className="text-center text-lg tracking-[0.4em]"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={!factorId || code.length !== 6 || isVerifying}>
              {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
