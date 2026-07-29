import { useState } from "react";
import { Routes, Route } from "react-router-dom";
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
import Retail from "@/pages/dashboard/Retail";
import Marketing from "@/pages/dashboard/Marketing";
import Hr from "@/pages/dashboard/Hr";
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
              <Route path="retail/*" element={<Retail />} />
              <Route path="marketing/*" element={<Marketing />} />
              <Route path="hr/*" element={<Hr />} />
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
