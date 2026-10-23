import { RequireModule } from '@/components/auth/RequireModule';
import { RequireRole } from '@/components/auth/RequireRole';
import PaymentsList from '@/pages/dashboard/payments/PaymentsList';

export default function Payments() {
  return (
    <RequireModule module="payments">
      {/* 0050: los cobros solo los ven los administradores. */}
      <RequireRole minRole="admin">
        <PaymentsList />
      </RequireRole>
    </RequireModule>
  );
}
