// Decide por dónde sale cada documento: QZ Tray si este equipo lo tiene activado y hay impresora
// elegida; si no, o si QZ Tray falla, el cuadro de impresión del navegador (printTicket).
import { toast } from 'sonner';
import { labelsHtml, printLabels, type LabelConfig, type LabelData } from './labels';
import { connectQz, printHtml, printRaw } from './qzTray';
import {
  loadTerminalPrefs, printTicket, printableWidthMm, ticketHtml,
  type TerminalTicketPrefs, type TicketBusiness, type TicketDoc,
} from './ticket';

/** sale y refund: el documento acaba de nacer. reprint: otra copia, sin cajón. */
export type PrintPurpose = 'sale' | 'refund' | 'reprint' | 'duplicate' | 'test';

// ESC/POS de Epson (TM-T20II): avanzar y corte parcial; pulso al cajón por el pin 2.
export const ESC_POS_CUT = '1D564200';
export const ESC_POS_DRAWER = '1B700019FA';

/** Impresora de este equipo para un documento. Nunca la predeterminada de Windows: puede ser la de etiquetas. */
export function printerFor(prefs: TerminalTicketPrefs, doc: TicketDoc, purpose: PrintPurpose): string | null {
  if (!prefs.qzEnabled) return null;
  const { ticket, refund, duplicate } = prefs.printers;
  if (purpose === 'duplicate') return duplicate || ticket || null;
  if (doc.kind === 'refund') return refund || ticket || null;
  return ticket || null;
}

/** El cajón solo se abre en cobros y devoluciones en efectivo recién hechos. */
export function opensDrawer(prefs: TerminalTicketPrefs, doc: TicketDoc, purpose: PrintPurpose): boolean {
  if (!prefs.qzEnabled || !prefs.qzDrawer) return false;
  return (purpose === 'sale' || purpose === 'refund') && doc.paymentMethod === 'cash';
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'error desconocido');

/** Abre el cajón sin imprimir (venta en efectivo con la impresión automática apagada). */
export async function openCashDrawer(
  businessId: string | null | undefined,
  prefs: TerminalTicketPrefs,
  doc: TicketDoc,
  purpose: PrintPurpose,
) {
  const printer = printerFor(prefs, doc, purpose);
  if (!businessId || !printer || !opensDrawer(prefs, doc, purpose)) return;
  const qz = await connectQz(businessId);
  if (!qz) {
    toast.error('No se ha podido abrir el cajón: QZ Tray no responde.');
    return;
  }
  await printRaw(qz, printer, ESC_POS_DRAWER).catch((e) => {
    toast.error(`No se ha podido abrir el cajón: ${errorText(e)}`);
  });
}

/** Imprime un documento y dice por dónde ha salido. */
export async function printDocument(
  businessId: string | null | undefined,
  biz: TicketBusiness,
  doc: TicketDoc,
  prefs: TerminalTicketPrefs,
  purpose: PrintPurpose,
): Promise<'qz' | 'browser'> {
  const printer = printerFor(prefs, doc, purpose);
  const qz = businessId && printer ? await connectQz(businessId) : null;
  if (!qz || !printer) {
    if (prefs.qzEnabled && opensDrawer(prefs, doc, purpose)) {
      toast.error('QZ Tray no responde: abre el cajón a mano.');
    }
    printTicket(biz, doc, prefs);
    return 'browser';
  }

  // Primero el cajón: el cobro no espera al papel, y un fallo al imprimir no lo deja cerrado.
  if (opensDrawer(prefs, doc, purpose)) {
    await printRaw(qz, printer, ESC_POS_DRAWER).catch((e) => {
      toast.error(`No se ha podido abrir el cajón: ${errorText(e)}`);
    });
  }

  const html = ticketHtml(biz, doc, prefs, 1);
  const copies = Math.max(1, Math.min(prefs.copies, 3));
  for (let copy = 0; copy < copies; copy += 1) {
    try {
      await printHtml(qz, { printer, html, widthMm: printableWidthMm(prefs.paperWidth) });
      if (prefs.qzCut) await printRaw(qz, printer, ESC_POS_CUT);
    } catch (e) {
      toast.error(`QZ Tray no ha podido imprimir: ${errorText(e)}`);
      // Si ya salió alguna copia, no se repite todo por el navegador.
      if (copy > 0) return 'qz';
      printTicket(biz, doc, prefs);
      return 'browser';
    }
  }
  return 'qz';
}

/** Etiquetas de rollo a su impresora si este equipo la tiene elegida; las de hoja A4, siempre por el navegador. */
export async function printLabelsDirect(
  businessId: string | null | undefined,
  config: LabelConfig,
  labels: (LabelData | null)[],
  taxRate: number,
): Promise<'qz' | 'browser'> {
  const prefs = loadTerminalPrefs();
  const printer = prefs.qzEnabled ? prefs.printers.label : undefined;
  const qz = businessId && printer && config.sheet.mode === 'roll' ? await connectQz(businessId) : null;
  if (!qz || !printer) {
    printLabels(config, labels, taxRate);
    return 'browser';
  }
  try {
    await printHtml(qz, {
      printer,
      html: labelsHtml(config, labels, taxRate),
      widthMm: config.sheet.rollWidthMm,
      heightMm: config.sheet.rollHeightMm,
    });
    return 'qz';
  } catch (e) {
    toast.error(`QZ Tray no ha podido imprimir: ${errorText(e)}`);
    printLabels(config, labels, taxRate);
    return 'browser';
  }
}
