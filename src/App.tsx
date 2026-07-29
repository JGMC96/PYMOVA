import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BusinessProvider } from "@/contexts/BusinessContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import SelectBusiness from "./pages/SelectBusiness";
import NotFound from "./pages/NotFound";
import MejoresErpPymes from "./pages/blog/MejoresErpPymes";
import NegociosRentables2026 from "./pages/blog/NegociosRentables2026";
import GuiaVerifactu2026 from "./pages/blog/GuiaVerifactu2026";
import AcceptInvitation from "./pages/AcceptInvitation";
import Unsubscribe from "./pages/Unsubscribe";

import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireBusiness } from "./components/auth/RequireBusiness";
import { AuthRedirector } from "./components/auth/AuthRedirector";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminBusinesses from "./pages/admin/AdminBusinesses";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <BusinessProvider>
          <AuthRedirector />
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/blog/mejores-erp-pymes" element={<MejoresErpPymes />} />
            <Route path="/blog/negocios-rentables-2026" element={<NegociosRentables2026 />} />
            <Route path="/blog/guia-verifactu-2026" element={<GuiaVerifactu2026 />} />
            <Route path="/invite/:token" element={<AcceptInvitation />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />

            
            {/* Auth required routes */}
            <Route path="/onboarding" element={
              <RequireAuth>
                <Onboarding />
              </RequireAuth>
            } />
            <Route path="/select-business" element={
              <RequireAuth>
                <SelectBusiness />
              </RequireAuth>
            } />
            
            {/* Dashboard - requires auth + business */}
            <Route path="/dashboard/*" element={
              <RequireAuth>
                <RequireBusiness>
                  <Dashboard />
                </RequireBusiness>
              </RequireAuth>
            } />

            {/* Super admin panel - requires auth + super_admin role (checked inside) */}
            <Route path="/admin" element={
              <RequireAuth>
                <AdminLayout />
              </RequireAuth>
            }>
              <Route index element={<AdminOverview />} />
              <Route path="businesses" element={<AdminBusinesses />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="subscriptions" element={<AdminSubscriptions />} />
            </Route>

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BusinessProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
