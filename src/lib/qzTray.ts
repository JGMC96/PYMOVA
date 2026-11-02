// Conexión con QZ Tray, el programa que imprime sin cuadro de diálogo en el equipo de la tienda.
// El cliente (public/vendor) solo se carga en los equipos que lo activan. Firma: edge function qz-sign.
import { supabase } from '@/integrations/supabase/client';

const CLIENT_URL = '/vendor/qz-tray-2.3.0.js';
const CERT_KEY = 'pymova_qz_certificate';
/** Lo que se espera a QZ Tray antes de imprimir por el navegador. */
export const QZ_CONNECT_TIMEOUT_MS = 1000;

/** Densidad de las térmicas habituales: 203 ppp ≈ 8 puntos por mm. */
const DENSITY_DPMM = 8;

interface QzApi {
  websocket: {
    isActive(): boolean;
    connect(options?: { retries?: number }): Promise<void>;
    disconnect(): Promise<void>;
  };
  security: {
    setCertificatePromise(
      handler: (resolve: (cert: string) => void, reject: (e: unknown) => void) => void,
      options?: { rejectOnFailure?: boolean },
    ): void;
    setSignatureAlgorithm(algorithm: string): void;
    setSignaturePromise(
      factory: (toSign: string) => (resolve: (sig: string) => void, reject: (e: unknown) => void) => void,
    ): void;
  };
  printers: { find(): Promise<string[]> };
  api: { getVersion(): Promise<string> };
  configs: { create(printer: string, options?: Record<string, unknown>): unknown };
  print(config: unknown, data: unknown[]): Promise<void>;
}

declare global {
  interface Window { qz?: QzApi }
}

let businessId: string | null = null;
let clientPromise: Promise<QzApi> | null = null;
let connecting: Promise<void> | null = null;

async function invokeSign<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('qz-sign', { body: { business_id: businessId, ...body } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

const readCachedCert = () => {
  try { return localStorage.getItem(CERT_KEY); } catch { return null; }
};

async function fetchCertificate(): Promise<string> {
  const { certificate } = await invokeSign<{ certificate: string }>({ action: 'certificate' });
  try { localStorage.setItem(CERT_KEY, certificate); } catch { /* sin guardar: se pide otra vez */ }
  return certificate;
}

function loadClient(): Promise<QzApi> {
  clientPromise ??= new Promise<QzApi>((resolve, reject) => {
    const setUp = () => {
      const qz = window.qz;
      if (!qz) { reject(new Error('No se ha cargado QZ Tray')); return; }
      // El certificado se guarda en el equipo: pedirlo en cada conexión gastaría el tiempo de espera.
      qz.security.setCertificatePromise((res, rej) => {
        const cached = readCachedCert();
        if (cached) res(cached);
        else fetchCertificate().then(res, rej);
      }, { rejectOnFailure: true });
      qz.security.setSignatureAlgorithm('SHA512');
      qz.security.setSignaturePromise((toSign) => (res, rej) => {
        invokeSign<{ signature: string }>({ action: 'sign', request: toSign }).then((d) => res(d.signature), rej);
      });
      resolve(qz);
    };
    if (window.qz) { setUp(); return; }
    const script = document.createElement('script');
    script.src = CLIENT_URL;
    script.async = true;
    script.onload = setUp;
    script.onerror = () => { clientPromise = null; reject(new Error('No se ha cargado QZ Tray')); };
    document.head.appendChild(script);
  });
  return clientPromise;
}

/** Abre la conexión si hace falta; si tarda, sigue en segundo plano para la próxima impresión. */
function openConnection(qz: QzApi): Promise<void> {
  if (qz.websocket.isActive()) return Promise.resolve();
  connecting ??= qz.websocket.connect({ retries: 0 }).finally(() => { connecting = null; });
  return connecting;
}

/** QZ Tray conectado, o null si no responde a tiempo (entonces se imprime por el navegador). */
export async function connectQz(forBusinessId: string, timeoutMs = QZ_CONNECT_TIMEOUT_MS): Promise<QzApi | null> {
  businessId = forBusinessId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([
      loadClient().then((qz) => openConnection(qz).then(() => qz)),
      timeout,
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Comprobación de Ajustes: vuelve a pedir el certificado y reconecta, con errores legibles. */
export async function checkQz(forBusinessId: string): Promise<{ version: string; printers: string[] }> {
  businessId = forBusinessId;
  await fetchCertificate();
  const qz = await loadClient();
  if (qz.websocket.isActive()) await qz.websocket.disconnect();
  try {
    await openConnection(qz);
  } catch {
    throw new Error('No se encuentra QZ Tray en este equipo. Comprueba que está abierto (icono junto al reloj).');
  }
  const [version, printers] = await Promise.all([qz.api.getVersion(), qz.printers.find()]);
  return { version, printers };
}

export interface QzHtmlJob {
  printer: string;
  html: string;
  /** Ancho (y alto, si la hoja lo tiene fijo) del documento en mm. */
  widthMm: number;
  heightMm?: number;
}

/** Imprime HTML. Sin alto, el papel es el rollo que tenga la impresora, igual que desde Chrome. */
export async function printHtml(qz: QzApi, job: QzHtmlJob) {
  const config = qz.configs.create(job.printer, {
    units: 'mm',
    margins: 0,
    density: DENSITY_DPMM,
    colorType: 'blackwhite',
    interpolation: 'nearest-neighbor',
    ...(job.heightMm ? { size: { width: job.widthMm, height: job.heightMm }, scaleContent: false } : {}),
  });
  await qz.print(config, [{
    type: 'pixel',
    format: 'html',
    flavor: 'plain',
    data: job.html,
    options: { pageWidth: job.widthMm, ...(job.heightMm ? { pageHeight: job.heightMm } : {}) },
  }]);
}

/** Envía órdenes ESC/POS en hexadecimal a la impresora. */
export async function printRaw(qz: QzApi, printer: string, hex: string) {
  await qz.print(qz.configs.create(printer), [{ type: 'raw', format: 'command', flavor: 'hex', data: hex }]);
}
