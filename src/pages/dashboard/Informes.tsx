// Apartado «Informes»: solo para el propietario. La seguridad real está en cada RPC
// (`has_business_role(..., 'owner')`); aquí solo se oculta la pantalla.
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole } from '@/components/auth/RequireRole';
import { SalesReportPanel } from '@/components/informes/SalesReportPanel';
import { INFORME_TABS } from '@/lib/informes';
import { cn } from '@/lib/utils';

export default function Informes() {
  return (
    <RequireRole minRole="owner">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Informes</h1>
          <p className="text-muted-foreground mt-1">
            Cifras de la tienda en solo lectura, con los tickets de Stockagile y la comparación con el año anterior.
          </p>
        </div>
        <nav className="flex gap-1 border-b" aria-label="Informes">
          {INFORME_TABS.map((t) => (
            <NavLink
              key={t.path}
              to={`/dashboard/informes/${t.path}`}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <Routes>
          <Route path="ventas" element={<SalesReportPanel />} />
          <Route path="*" element={<Navigate to="/dashboard/informes/ventas" replace />} />
        </Routes>
      </div>
    </RequireRole>
  );
}
