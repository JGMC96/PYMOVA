import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const BIZ = '11111111-2222-4333-8444-555555555555';
const CERT_KEY = 'pymova_qz_certificate';

type Handler = (resolve: (v: string) => void, reject: (e: unknown) => void) => void;

function fakeQz(connect: () => Promise<void> = () => Promise.resolve()) {
  let active = false;
  const qz = {
    certHandler: null as Handler | null,
    certOptions: null as unknown,
    signFactory: null as ((s: string) => Handler) | null,
    algorithm: '',
    websocket: {
      isActive: () => active,
      connect: vi.fn(() => connect().then(() => { active = true; })),
      disconnect: vi.fn(async () => { active = false; }),
    },
    security: {
      setCertificatePromise(h: Handler, o: unknown) { qz.certHandler = h; qz.certOptions = o; },
      setSignatureAlgorithm(a: string) { qz.algorithm = a; },
      setSignaturePromise(f: (s: string) => Handler) { qz.signFactory = f; },
    },
    printers: { find: vi.fn(async () => ['EPSON', '4BARCODE']) },
    api: { getVersion: vi.fn(async () => '2.2.5') },
    configs: { create: vi.fn((printer: string, options?: unknown) => ({ printer, options })) },
    print: vi.fn(async () => undefined),
  };
  (window as unknown as { qz: unknown }).qz = qz;
  return qz;
}

const load = () => import('@/lib/qzTray');
const asPromise = (h: Handler) => new Promise<string>((res, rej) => h(res, rej));

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  invoke.mockReset();
  localStorage.clear();
});

describe('conexión', () => {
  it('conecta y prepara la firma con SHA-512, rechazando si no hay certificado', async () => {
    const qz = fakeQz();
    const { connectQz } = await load();
    await expect(connectQz(BIZ)).resolves.toBe(qz);
    expect(qz.algorithm).toBe('SHA512');
    expect(qz.certOptions).toEqual({ rejectOnFailure: true });
  });

  it('no vuelve a conectar si ya está activa', async () => {
    const qz = fakeQz();
    const { connectQz } = await load();
    await connectQz(BIZ);
    await connectQz(BIZ);
    expect(qz.websocket.connect).toHaveBeenCalledTimes(1);
  });

  it('si no responde a tiempo devuelve null, y la conexión sigue para la próxima', async () => {
    let finish: () => void = () => undefined;
    const qz = fakeQz(() => new Promise<void>((res) => { finish = res; }));
    const { connectQz } = await load();
    await expect(connectQz(BIZ, 10)).resolves.toBeNull();
    finish();
    await expect(connectQz(BIZ, 10)).resolves.toBe(qz);
    expect(qz.websocket.connect).toHaveBeenCalledTimes(1);
  });

  it('si QZ Tray no está, devuelve null', async () => {
    fakeQz(() => Promise.reject(new Error('sin QZ')));
    const { connectQz } = await load();
    await expect(connectQz(BIZ)).resolves.toBeNull();
  });
});

describe('certificado y firma', () => {
  it('usa el certificado guardado sin llamar al servidor', async () => {
    localStorage.setItem(CERT_KEY, 'CERT');
    const qz = fakeQz();
    const { connectQz } = await load();
    await connectQz(BIZ);
    await expect(asPromise(qz.certHandler!)).resolves.toBe('CERT');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sin guardar, lo pide con el negocio activo y lo guarda', async () => {
    invoke.mockResolvedValue({ data: { certificate: 'CERT' }, error: null });
    const qz = fakeQz();
    const { connectQz } = await load();
    await connectQz(BIZ);
    await expect(asPromise(qz.certHandler!)).resolves.toBe('CERT');
    expect(invoke).toHaveBeenCalledWith('qz-sign', { body: { business_id: BIZ, action: 'certificate' } });
    expect(localStorage.getItem(CERT_KEY)).toBe('CERT');
  });

  it('firma lo que pide QZ Tray', async () => {
    invoke.mockResolvedValue({ data: { signature: 'FIRMA' }, error: null });
    const qz = fakeQz();
    const { connectQz } = await load();
    await connectQz(BIZ);
    await expect(asPromise(qz.signFactory!('abc'))).resolves.toBe('FIRMA');
    expect(invoke).toHaveBeenCalledWith('qz-sign', { body: { business_id: BIZ, action: 'sign', request: 'abc' } });
  });

  it('un error del servidor llega con su texto', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ error: 'Falta configurar la clave de QZ Tray' }) } },
    });
    const qz = fakeQz();
    const { connectQz } = await load();
    await connectQz(BIZ);
    await expect(asPromise(qz.signFactory!('abc'))).rejects.toThrow('Falta configurar la clave');
  });
});

describe('comprobación de Ajustes', () => {
  it('renueva el certificado, reconecta y devuelve versión e impresoras', async () => {
    localStorage.setItem(CERT_KEY, 'VIEJO');
    invoke.mockResolvedValue({ data: { certificate: 'NUEVO' }, error: null });
    const qz = fakeQz();
    const { checkQz, connectQz } = await load();
    await connectQz(BIZ);
    await expect(checkQz(BIZ)).resolves.toEqual({ version: '2.2.5', printers: ['EPSON', '4BARCODE'] });
    expect(localStorage.getItem(CERT_KEY)).toBe('NUEVO');
    expect(qz.websocket.disconnect).toHaveBeenCalledTimes(1);
    expect(qz.websocket.connect).toHaveBeenCalledTimes(2);
  });

  it('sin QZ Tray lo dice en claro', async () => {
    invoke.mockResolvedValue({ data: { certificate: 'CERT' }, error: null });
    fakeQz(() => Promise.reject(new Error('socket')));
    const { checkQz } = await load();
    await expect(checkQz(BIZ)).rejects.toThrow('No se encuentra QZ Tray');
  });
});

describe('trabajos de impresión', () => {
  it('HTML de rollo: sin alto, el papel es el de la impresora', async () => {
    const qz = fakeQz();
    const { connectQz, printHtml } = await load();
    await connectQz(BIZ);
    await printHtml(qz as never, { printer: 'EPSON', html: '<p>x</p>', widthMm: 72 });
    const [config, data] = qz.print.mock.calls[0] as unknown as [{ printer: string; options: Record<string, unknown> }, unknown[]];
    expect(config.printer).toBe('EPSON');
    expect(config.options).toMatchObject({ units: 'mm', margins: 0, density: 8, colorType: 'blackwhite' });
    expect(config.options.size).toBeUndefined();
    expect(data).toEqual([{ type: 'pixel', format: 'html', flavor: 'plain', data: '<p>x</p>', options: { pageWidth: 72 } }]);
  });

  it('HTML de etiqueta: con el tamaño justo', async () => {
    const qz = fakeQz();
    const { connectQz, printHtml } = await load();
    await connectQz(BIZ);
    await printHtml(qz as never, { printer: '4BARCODE', html: 'x', widthMm: 50, heightMm: 30 });
    const [config, data] = qz.print.mock.calls[0] as unknown as [{ options: Record<string, unknown> }, { options: unknown }[]];
    expect(config.options).toMatchObject({ size: { width: 50, height: 30 }, scaleContent: false });
    expect(data[0].options).toEqual({ pageWidth: 50, pageHeight: 30 });
  });

  it('ESC/POS en hexadecimal', async () => {
    const qz = fakeQz();
    const { connectQz, printRaw } = await load();
    await connectQz(BIZ);
    await printRaw(qz as never, 'EPSON', '1D564200');
    expect(qz.print.mock.calls[0][1 as never]).toEqual([{ type: 'raw', format: 'command', flavor: 'hex', data: '1D564200' }]);
  });
});
