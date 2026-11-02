import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '@/contexts/BusinessContext';
import { useBusinessSettings } from '@/hooks/useBusinessSettings';
import {
  isTerminalPrefsKey, loadTerminalPrefs, saveTerminalPrefs, type TerminalTicketPrefs, type TicketBusiness, type TicketDoc,
} from '@/lib/ticket';
import { openCashDrawer, printDocument, type PrintPurpose } from '@/lib/ticketPrint';

/** Datos del negocio para el ticket + preferencias de impresión de este equipo. */
export function useTicketConfig() {
  const { activeBusiness } = useBusiness();
  const bs = useBusinessSettings();
  const [prefs, setPrefsState] = useState<TerminalTicketPrefs>(loadTerminalPrefs);

  const setPrefs = useCallback((p: TerminalTicketPrefs) => {
    setPrefsState(p);
    saveTerminalPrefs(p);
  }, []);

  // Un TPV ya abierto también recoge lo que se cambie en Ajustes desde otra pestaña.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (isTerminalPrefsKey(e.key)) setPrefsState(loadTerminalPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const s = bs.settings;
  const business: TicketBusiness = {
    name: s?.ticket_trade_name || activeBusiness?.trade_name || activeBusiness?.name || 'Mi negocio',
    legalName: s?.ticket_legal_name || activeBusiness?.legal_name,
    taxId: s?.ticket_tax_id || activeBusiness?.tax_id,
    fontSize: s?.ticket_font_size ?? 'normal',
    lineSpacing: s?.ticket_line_spacing ?? 'normal',
    boldItems: s?.ticket_bold_items ?? true,
    logoUrl: (activeBusiness as { logo_url?: string | null } | null)?.logo_url ?? null,
    showLogo: s?.ticket_show_logo ?? true,
    address: s?.ticket_address,
    phone: s?.ticket_phone,
    website: s?.ticket_website,
    header: s?.ticket_header,
    footer: s?.ticket_footer,
    returnPolicy: s?.ticket_return_policy,
  };

  const businessId = activeBusiness?.id;
  const print = (doc: TicketDoc, purpose: PrintPurpose, biz: TicketBusiness = business) =>
    printDocument(businessId, biz, doc, prefs, purpose);
  const openDrawer = (doc: TicketDoc, purpose: PrintPurpose) => openCashDrawer(businessId, prefs, doc, purpose);

  return { business, prefs, setPrefs, print, openDrawer, taxRate: bs.taxRate, settingsApi: bs };
}
