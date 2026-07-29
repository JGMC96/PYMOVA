import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { checkIsSuperAdmin } from "@/lib/superAdmin";
import { getPendingInvite } from "@/lib/inviteLink";

/**
 * Global listener that redirects authenticated users away from public
 * landing/auth pages to /dashboard, /onboarding or /admin depending on:
 *  - whether they belong to a business
 *  - whether they have the super_admin platform role
 */
export const AuthRedirector = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const PUBLIC_PATHS = ["/", "/auth"];

    const routeForUser = (userId: string) => {
      // Defer to avoid deadlocks inside onAuthStateChange
      setTimeout(async () => {
        if (!PUBLIC_PATHS.includes(location.pathname)) return;

        // Si venía de un enlace de invitación, completarlo primero
        const pendingInvite = getPendingInvite();
        if (pendingInvite) {
          navigate(`/invite/${pendingInvite}`, { replace: true });
          return;
        }

        const { data: memberships } = await supabase
          .from("business_members")
          .select("business_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1);

        const hasBusiness = memberships && memberships.length > 0;

        if (hasBusiness) {
          navigate("/dashboard", { replace: true });
          return;
        }

        // Sin negocios: si es super admin, mandarlo al panel admin
        const isSuperAdmin = await checkIsSuperAdmin(userId);
        if (isSuperAdmin) {
          navigate("/admin", { replace: true });
        } else {
          navigate("/onboarding", { replace: true });
        }
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) routeForUser(session.user.id);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) routeForUser(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname]);

  return null;
};
