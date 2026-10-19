import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Building2, Users, CreditCard, ShieldCheck, ArrowLeft, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

const NAV = [
  { to: '/admin', label: 'Resumen', icon: ShieldCheck, end: true },
  { to: '/admin/businesses', label: 'Negocios', icon: Building2 },
  { to: '/admin/users', label: 'Usuarios', icon: Users },
  { to: '/admin/subscriptions', label: 'Suscripciones', icon: CreditCard },
  { to: '/admin/activity', label: 'Actividad', icon: History },
];

function AdminShell() {
  const location = useLocation();
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold leading-tight">Panel Super Admin</h1>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />Volver al dashboard</Link>
          </Button>
        </div>
        <nav className="container mx-auto px-6 flex gap-1 -mb-px">
          {NAV.map(item => {
            const active = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors',
                  active
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="container mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <RequireSuperAdmin>
      <AdminShell />
    </RequireSuperAdmin>
  );
}
