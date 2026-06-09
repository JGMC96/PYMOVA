import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import type { 
  Business, 
  AppRole, 
  ModuleKey,
  BusinessWithMembership,
  BusinessModuleWithKey
} from '@/types/database';

interface BusinessContextType {
  // Auth state
  user: User | null;
  isAuthLoading: boolean;
  
  // Business state
  activeBusinessId: string | null;
  activeBusiness: BusinessWithMembership | null;
  userBusinesses: BusinessWithMembership[];
  userRole: AppRole | null;
  enabledModules: ModuleKey[];
  
  // Actions
  setActiveBusiness: (businessId: string) => Promise<void>;
  refreshBusinesses: () => Promise<void>;
  signOut: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

const ACTIVE_BUSINESS_KEY = 'totalbusiness_active_business_id';

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  // Business state
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [activeBusiness, setActiveBusinessState] = useState<BusinessWithMembership | null>(null);
  const [userBusinesses, setUserBusinesses] = useState<BusinessWithMembership[]>([]);
  const [enabledModules, setEnabledModules] = useState<ModuleKey[]>([]);

  // Derived state
  const userRole = activeBusiness?.role ?? null;

  // Fetch user's businesses with memberships
  const fetchUserBusinesses = useCallback(async (userId: string): Promise<BusinessWithMembership[]> => {
    const { data: memberships, error } = await supabase
      .from('business_members')
      .select(`
        role,
        business_id,
        businesses (
          id,
          name,
          slug,
          logo_url,
          industry,
          currency,
          timezone,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching businesses:', error);
      return [];
    }

    if (!memberships) return [];

    return memberships
      .filter((m): m is typeof m & { businesses: Business } => m.businesses !== null)
      .map((m) => ({
        ...m.businesses,
        role: m.role as AppRole,
      }));
  }, []);

  // Fetch modules for a business (now using module_id FK and joining with modules table)
  const fetchBusinessModules = useCallback(async (businessId: string): Promise<ModuleKey[]> => {
    const { data, error } = await supabase
      .from('business_modules')
      .select(`
        module_id,
        is_enabled,
        modules (
          key
        )
      `)
      .eq('business_id', businessId)
      .eq('is_enabled', true);

    if (error) {
      console.error('Error fetching modules:', error);
      return [];
    }

    return (data || [])
      .filter((m) => m.modules !== null)
      .map((m) => (m.modules as { key: string }).key as ModuleKey);
  }, []);

  // Fetch active business from profile
  const fetchActiveBusinessFromProfile = useCallback(async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user?.id)
      .single();

    if (error || !data) {
      return null;
    }

    return data.active_business_id;
  }, [user?.id]);

  // Set active business (persists to DB and localStorage)
  const handleSetActiveBusiness = useCallback(async (businessId: string) => {
    const business = userBusinesses.find((b) => b.id === businessId);
    if (!business) {
      console.error('Business not found in user businesses');
      return;
    }

    // Update local state immediately
    setActiveBusinessId(businessId);
    setActiveBusinessState(business);
    localStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);

    // Persist to database via RPC
    try {
      await supabase.rpc('set_active_business', { _business_id: businessId });
    } catch (error) {
      console.error('Error persisting active business:', error);
    }

    // Fetch enabled modules
    const modules = await fetchBusinessModules(businessId);
    setEnabledModules(modules);
  }, [userBusinesses, fetchBusinessModules]);

  // Refresh businesses
  const refreshBusinesses = useCallback(async () => {
    if (!user) return;

    const businesses = await fetchUserBusinesses(user.id);
    setUserBusinesses(businesses);

    // If active business no longer accessible, clear it
    if (activeBusinessId && !businesses.find((b) => b.id === activeBusinessId)) {
      setActiveBusinessId(null);
      setActiveBusinessState(null);
      setEnabledModules([]);
      localStorage.removeItem(ACTIVE_BUSINESS_KEY);
    }
  }, [user, activeBusinessId, fetchUserBusinesses]);

  // Sign out — revoca sesión global + limpia storage + cierra sesión Google
  // Lanza error si la revocación falla, para que la UI pueda ofrecer reintento.
  const signOut = useCallback(async () => {
    // 1. Revocar sesión globalmente (invalida refresh tokens en el servidor)
    // Si esto falla, NO limpiamos nada y propagamos el error para reintento.
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      console.error('signOut error:', error);
      throw new Error(error.message || 'No se pudo revocar la sesión en el servidor');
    }

    // 2. Reset estado local
    setUser(null);
    setActiveBusinessId(null);
    setActiveBusinessState(null);
    setUserBusinesses([]);
    setEnabledModules([]);

    // 3. Borrar TODO rastro de sesión (incluye claves sb-* de Supabase)
    try {
      localStorage.removeItem(ACTIVE_BUSINESS_KEY);
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-') || k.includes('supabase'))
        .forEach((k) => localStorage.removeItem(k));
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('sb-') || k.includes('supabase'))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch {}

    // 4. Revocar cookie de Google en background para evitar auto-login
    try {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = 'https://accounts.google.com/Logout';
    } catch {}

    navigate('/');
  }, [navigate]);


  // Initialize auth listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setIsAuthLoading(false);

      if (!session?.user) {
        setActiveBusinessId(null);
        setActiveBusinessState(null);
        setUserBusinesses([]);
        setEnabledModules([]);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch businesses when user changes
  useEffect(() => {
    if (!user) return;

    const loadBusinesses = async () => {
      const businesses = await fetchUserBusinesses(user.id);
      setUserBusinesses(businesses);

      // Try to restore active business: 1) from DB profile, 2) from localStorage, 3) auto-select if only one
      let activeId: string | null = null;
      
      // First, try to get from profile (DB source of truth)
      const profileActiveId = await fetchActiveBusinessFromProfile();
      if (profileActiveId && businesses.find((b) => b.id === profileActiveId)) {
        activeId = profileActiveId;
      }

      // Fallback to localStorage
      if (!activeId) {
        const storedBusinessId = localStorage.getItem(ACTIVE_BUSINESS_KEY);
        if (storedBusinessId && businesses.find((b) => b.id === storedBusinessId)) {
          activeId = storedBusinessId;
        }
      }

      // Auto-select if only one business
      if (!activeId && businesses.length === 1) {
        activeId = businesses[0].id;
      }

      if (activeId) {
        const activeBiz = businesses.find((b) => b.id === activeId)!;
        setActiveBusinessId(activeId);
        setActiveBusinessState(activeBiz);
        localStorage.setItem(ACTIVE_BUSINESS_KEY, activeId);
        
        const modules = await fetchBusinessModules(activeId);
        setEnabledModules(modules);
      }
    };

    loadBusinesses();
  }, [user, fetchUserBusinesses, fetchBusinessModules, fetchActiveBusinessFromProfile]);

  const value: BusinessContextType = {
    user,
    isAuthLoading,
    activeBusinessId,
    activeBusiness,
    userBusinesses,
    userRole,
    enabledModules,
    setActiveBusiness: handleSetActiveBusiness,
    refreshBusinesses,
    signOut,
  };

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
}
