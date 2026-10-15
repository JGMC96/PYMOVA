import { useCallback, useState } from 'react';
import { useBusiness } from '@/contexts/BusinessContext';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import {
  loadTerminalPrefs, saveTerminalPrefs, type TerminalTicketPrefs, type TicketBusiness,
} from '@/lib/ticket';

/** Datos del negocio para el ticket + preferencias de impresión de este equipo. */
export function useTicketConfig() {
  const { activeBusiness } = useBusiness();
  const bs = useBusinessSettings();
  const [prefs, setPrefsState] = useState<TerminalTicketPrefs>(loadTerminalPrefs);

  const setPrefs = useCallback((p: TerminalTicketPrefs) => {
    setPrefsState(p);
    saveTerminalPrefs(p);
  }, []);

  const s = bs.settings;
  const business: TicketBusiness = {
    name: activeBusiness?.trade_name || activeBusiness?.name || 'Mi negocio',
    legalName: activeBusiness?.legal_name,
    taxId: activeBusiness?.tax_id,
    logoUrl: (activeBusiness as { logo_url?: string | null } | null)?.logo_url ?? null,
    showLogo: s?.ticket_show_logo ?? true,
    address: s?.ticket_address,
    phone: s?.ticket_phone,
    website: s?.ticket_website,
    header: s?.ticket_header,
    footer: s?.ticket_footer,
    returnPolicy: s?.ticket_return_policy,
  };

  return { business, prefs, setPrefs, taxRate: bs.taxRate, settingsApi: bs };
}
