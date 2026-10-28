import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { useBusiness } from "@/contexts/BusinessContext";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import Clients from "@/pages/dashboard/Clients";
import Products from "@/pages/dashboard/Products";
import Invoices from "@/pages/dashboard/Invoices";
import Payments from "@/pages/dashboard/Payments";
import { RetailLayout } from "@/components/retail/RetailLayout";
import { PosPage, PurchasesPage, SalesHistoryPage, SellersPage } from "@/pages/dashboard/retail/RetailPages";
import { CashRegisterPanel } from "@/components/retail/CashRegisterPanel";
import { EcommercePanel } from "@/components/retail/EcommercePanel";
import { InventoryView } from "@/components/retail/InventoryView";
import { LabelsPanel } from "@/components/labels/LabelsPanel";
import { CodeProblemsPanel } from "@/components/inventory/CodeProblemsPanel";
import { RETAIL_HOME } from "@/lib/dashboardMenu";
import Marketing from "@/pages/dashboard/Marketing";
import Hr from "@/pages/dashboard/Hr";
import Informes from "@/pages/dashboard/Informes";
import Integrations from "@/pages/dashboard/Integrations";
import Settings from "@/pages/dashboard/Settings";
import LockedModulePage from "@/pages/dashboard/LockedModulePage";

const Dashboard = () => {
  const { user, activeBusiness, signOut } = useBusiness();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-background flex">
      <DashboardSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      
      <div className={`flex-1 transition-all duration-300 ${sidebarOpen ? "ml-64" : "ml-20"}`}>
        <DashboardHeader 
          user={user} 
          onLogout={signOut}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        />
        
        <main className="p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Routes>
              <Route index element={<DashboardOverview />} />
              <Route path="clients/*" element={<Clients />} />
              <Route path="products/*" element={<Products />} />
              <Route path="invoices/*" element={<Invoices />} />
              <Route path="payments/*" element={<Payments />} />
              {/* Tienda: cada pantalla con su entrada en el menú (antes, pestañas de Retail). */}
              <Route element={<RetailLayout />}>
                <Route path="sales/pos" element={<PosPage />} />
                <Route path="sales/register" element={<CashRegisterPanel />} />
                <Route path="sales/history" element={<SalesHistoryPage />} />
                <Route path="sales/online" element={<EcommercePanel />} />
                <Route path="stock/inventory" element={<InventoryView />} />
                <Route path="stock/purchases" element={<PurchasesPage />} />
                <Route path="stock/labels" element={<LabelsPanel />} />
                <Route path="stock/codes" element={<CodeProblemsPanel />} />
                <Route path="team/sellers" element={<SellersPage />} />
              </Route>
              <Route path="sales" element={<Navigate to={RETAIL_HOME} replace />} />
              <Route path="retail/*" element={<Navigate to={RETAIL_HOME} replace />} />
              <Route path="marketing/*" element={<Marketing />} />
              <Route path="hr/*" element={<Hr />} />
              <Route path="informes/*" element={<Informes />} />
              <Route path="integrations/*" element={<Integrations />} />
              <Route path="ai/*" element={

                <LockedModulePage moduleName="Asesor IA" moduleKey="ai_advisor" icon={MessageSquare} />
              } />
              <Route path="settings/*" element={<Settings />} />
            </Routes>
          </motion.div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
