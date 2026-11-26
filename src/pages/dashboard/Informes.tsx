// Apartado «Informes»: propietario y quien tenga el permiso «Ver ventas». La seguridad real
// está en cada RPC (`can_see_sales`); aquí solo se oculta la pantalla.
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { RequireSalesAccess } from '@/components/auth/RequireSalesAccess';
import { SalesReportPanel } from '@/components/informes/SalesReportPanel';
import { INFORME_TABS } from '@/lib/informes';
import { cn } from '@/lib/utils';

export default function Informes() {
  return (
    <RequireSalesAccess>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Informes</h1>
          <p className="text-muted-foreground mt-1">
            Ventas de la tienda y de la web en solo lectura, comparadas con el año anterior.
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
    </RequireSalesAccess>
  );
}
