import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type TerminalTicketPrefs, type TicketBusiness, type TicketDoc } from '@/lib/ticket';

const qz = {};
const mocks = vi.hoisted(() => ({
  connectQz: vi.fn(),
  printHtml: vi.fn(),
  printRaw: vi.fn(),
  printTicket: vi.fn(),
  printLabels: vi.fn(),
  loadTerminalPrefs: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/lib/qzTray', () => ({ connectQz: mocks.connectQz, printHtml: mocks.printHtml, printRaw: mocks.printRaw }));
vi.mock('@/lib/labels', async (original) => ({
  ...(await original<typeof import('@/lib/labels')>()),
  printLabels: mocks.printLabels,
}));
vi.mock('@/lib/ticket', async (original) => ({
  ...(await original<typeof import('@/lib/ticket')>()),
  printTicket: mocks.printTicket,
  loadTerminalPrefs: mocks.loadTerminalPrefs,
}));

const {
  ESC_POS_CUT, ESC_POS_DRAWER, openCashDrawer, opensDrawer, printDocument, printLabelsDirect, printerFor,
} = await import('@/lib/ticketPrint');
const { DEFAULT_LABEL_CONFIG } = await import('@/lib/labels');

const BIZ = '11111111-2222-4333-8444-555555555555';
const biz: TicketBusiness = { name: 'Tienda' };
const sale: TicketDoc = {
  kind: 'sale', number: 'V-1', createdAt: new Date(), lines: [], taxRate: 21, total: 10, paymentMethod: 'cash',
};
const qzPrefs = (over: Partial<TerminalTicketPrefs> = {}): TerminalTicketPrefs => ({
  ...DEFAULT_PREFS, qzEnabled: true, printers: { ticket: 'EPSON', refund: 'ABONOS', duplicate: 'COPIAS', label: '4BARCODE' }, qzDrawer: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectQz.mockResolvedValue(qz);
  mocks.printHtml.mockResolvedValue(undefined);
  mocks.printRaw.mockResolvedValue(undefined);
});

describe('impresora de cada documento', () => {
  it('apagado en este equipo, ninguna', () => {
    expect(printerFor(qzPrefs({ qzEnabled: false }), sale, 'sale')).toBeNull();
  });

  it('cada tipo la suya; abonos y duplicados usan la de tickets si no tienen', () => {
    const refund = { ...sale, kind: 'refund' as const };
    expect(printerFor(qzPrefs(), sale, 'sale')).toBe('EPSON');
    expect(printerFor(qzPrefs(), refund, 'refund')).toBe('ABONOS');
    expect(printerFor(qzPrefs(), sale, 'duplicate')).toBe('COPIAS');
    const only = qzPrefs({ printers: { ticket: 'EPSON' } });
    expect(printerFor(only, refund, 'refund')).toBe('EPSON');
    expect(printerFor(only, sale, 'duplicate')).toBe('EPSON');
  });
});

describe('cajón', () => {
  it('solo en cobros y devoluciones en efectivo recién hechos', () => {
    expect(opensDrawer(qzPrefs(), sale, 'sale')).toBe(true);
    expect(opensDrawer(qzPrefs(), { ...sale, kind: 'refund' }, 'refund')).toBe(true);
    expect(opensDrawer(qzPrefs(), { ...sale, paymentMethod: 'card' }, 'sale')).toBe(false);
    expect(opensDrawer(qzPrefs(), sale, 'reprint')).toBe(false);
    expect(opensDrawer(qzPrefs(), sale, 'duplicate')).toBe(false);
    expect(opensDrawer(qzPrefs(), sale, 'test')).toBe(false);
    expect(opensDrawer(qzPrefs({ qzDrawer: false }), sale, 'sale')).toBe(false);
  });

  it('sin imprimir: solo el pulso, y nada si es tarjeta', async () => {
    await openCashDrawer(BIZ, qzPrefs(), sale, 'sale');
    expect(mocks.printRaw).toHaveBeenCalledWith(qz, 'EPSON', ESC_POS_DRAWER);
    mocks.printRaw.mockClear();
    await openCashDrawer(BIZ, qzPrefs(), { ...sale, paymentMethod: 'card' }, 'sale');
    expect(mocks.printRaw).not.toHaveBeenCalled();
  });
});

describe('printDocument', () => {
  it('con QZ Tray: cajón, ticket y corte, sin cuadro del navegador', async () => {
    await expect(printDocument(BIZ, biz, sale, qzPrefs(), 'sale')).resolves.toBe('qz');
    expect(mocks.printRaw.mock.calls.map((c) => c[2])).toEqual([ESC_POS_DRAWER, ESC_POS_CUT]);
    expect(mocks.printHtml).toHaveBeenCalledTimes(1);
    expect(mocks.printHtml.mock.calls[0][1]).toMatchObject({ printer: 'EPSON', widthMm: 72 });
    expect(mocks.printTicket).not.toHaveBeenCalled();
  });

  it('un duplicado no abre el cajón', async () => {
    await printDocument(BIZ, biz, sale, qzPrefs(), 'duplicate');
    expect(mocks.printRaw.mock.calls.map((c) => c[2])).toEqual([ESC_POS_CUT]);
  });

  it('cada copia con su corte, y sin corte si está apagado', async () => {
    await printDocument(BIZ, biz, sale, qzPrefs({ copies: 2, qzDrawer: false }), 'sale');
    expect(mocks.printHtml).toHaveBeenCalledTimes(2);
    expect(mocks.printRaw).toHaveBeenCalledTimes(2);
    mocks.printRaw.mockClear();
    await printDocument(BIZ, biz, sale, qzPrefs({ qzCut: false, qzDrawer: false }), 'sale');
    expect(mocks.printRaw).not.toHaveBeenCalled();
  });

  it('apagado o sin impresora elegida: el navegador, sin tocar QZ Tray', async () => {
    await expect(printDocument(BIZ, biz, sale, DEFAULT_PREFS, 'sale')).resolves.toBe('browser');
    await expect(printDocument(BIZ, biz, sale, qzPrefs({ printers: {} }), 'test')).resolves.toBe('browser');
    expect(mocks.connectQz).not.toHaveBeenCalled();
    expect(mocks.printTicket).toHaveBeenCalledTimes(2);
  });

  it('si QZ Tray no conecta: el navegador, y avisa de abrir el cajón a mano', async () => {
    mocks.connectQz.mockResolvedValue(null);
    await expect(printDocument(BIZ, biz, sale, qzPrefs(), 'sale')).resolves.toBe('browser');
    expect(mocks.printTicket).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('cajón'));
  });

  it('si falla la primera copia: el navegador; si falla otra, no se repite todo', async () => {
    mocks.printHtml.mockRejectedValueOnce(new Error('sin papel'));
    await expect(printDocument(BIZ, biz, sale, qzPrefs({ qzDrawer: false }), 'sale')).resolves.toBe('browser');
    expect(mocks.printTicket).toHaveBeenCalledTimes(1);

    mocks.printTicket.mockClear();
    mocks.printHtml.mockReset();
    mocks.printHtml.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('sin papel'));
    await expect(printDocument(BIZ, biz, sale, qzPrefs({ copies: 2, qzDrawer: false }), 'sale')).resolves.toBe('qz');
    expect(mocks.printTicket).not.toHaveBeenCalled();
  });

  it('un fallo del cajón no impide imprimir', async () => {
    mocks.printRaw.mockRejectedValueOnce(new Error('cable'));
    await expect(printDocument(BIZ, biz, sale, qzPrefs(), 'sale')).resolves.toBe('qz');
    expect(mocks.printHtml).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('cajón'));
  });
});

describe('printLabelsDirect', () => {
  const roll = { ...DEFAULT_LABEL_CONFIG, sheet: { ...DEFAULT_LABEL_CONFIG.sheet, mode: 'roll' as const } };

  it('rollo con impresora elegida: a QZ Tray con el tamaño de la etiqueta', async () => {
    mocks.loadTerminalPrefs.mockReturnValue(qzPrefs());
    await expect(printLabelsDirect(BIZ, roll, [], 21)).resolves.toBe('qz');
    expect(mocks.printHtml.mock.calls[0][1]).toMatchObject({ printer: '4BARCODE', widthMm: 50, heightMm: 30 });
    expect(mocks.printLabels).not.toHaveBeenCalled();
  });

  it('hoja A4 o sin impresora: el navegador', async () => {
    mocks.loadTerminalPrefs.mockReturnValue(qzPrefs());
    await expect(printLabelsDirect(BIZ, DEFAULT_LABEL_CONFIG, [], 21)).resolves.toBe('browser');
    mocks.loadTerminalPrefs.mockReturnValue(qzPrefs({ printers: { ticket: 'EPSON' } }));
    await expect(printLabelsDirect(BIZ, roll, [], 21)).resolves.toBe('browser');
    expect(mocks.connectQz).not.toHaveBeenCalled();
    expect(mocks.printLabels).toHaveBeenCalledTimes(2);
  });
});
