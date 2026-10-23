import { Routes, Route } from 'react-router-dom';
import { RequireModule } from '@/components/auth/RequireModule';
import { RequireRole } from '@/components/auth/RequireRole';
import InvoicesList from '@/pages/dashboard/invoices/InvoicesList';
import NewInvoicePage from '@/pages/dashboard/invoices/NewInvoicePage';

export default function Invoices() {
  return (
    <RequireModule module="invoicing">
      {/* 0050: las facturas solo las ven los administradores. */}
      <RequireRole minRole="admin">
        <Routes>
          <Route index element={<InvoicesList />} />
          <Route path="new" element={<NewInvoicePage />} />
        </Routes>
      </RequireRole>
    </RequireModule>
  );
}
