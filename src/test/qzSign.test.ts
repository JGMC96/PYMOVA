import { describe, expect, it } from 'vitest';
import { businessAllowed, normalizePem, pkcs8FromPem, signQzRequest } from '../../supabase/functions/_shared/qz-core';

const toPem = (der: ArrayBuffer) => {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
};

async function newKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-512' },
    true,
    ['sign', 'verify'],
  );
  return { pem: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), publicKey: pair.publicKey };
}

const verify = (publicKey: CryptoKey, signature: string, message: string) =>
  crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(message),
  );

describe('firma de QZ Tray', () => {
  it('firma en base64 con SHA-512 y se verifica con la clave pública', async () => {
    const { pem, publicKey } = await newKeys();
    const signature = await signQzRequest(pem, 'abc123');
    await expect(verify(publicKey, signature, 'abc123')).resolves.toBe(true);
    await expect(verify(publicKey, signature, 'otra cosa')).resolves.toBe(false);
  });

  it('admite la clave con los saltos de línea como «\\n» literales', async () => {
    const { pem, publicKey } = await newKeys();
    const signature = await signQzRequest(pem.replace(/\n/g, '\\n'), 'abc123');
    await expect(verify(publicKey, signature, 'abc123')).resolves.toBe(true);
  });

  it('rechaza lo que no es PKCS#8', () => {
    expect(() => pkcs8FromPem('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----')).toThrow('PKCS#8');
    expect(() => pkcs8FromPem('')).toThrow('PKCS#8');
  });

  it('normaliza el certificado', () => {
    expect(normalizePem('  a\\nb\\r\\nc\r\n')).toBe('a\nb\nc');
  });
});

describe('negocios con permiso de firma', () => {
  const id = 'ABCDEF12-2222-4333-8444-555555555555';

  it('sin lista, todos', () => {
    expect(businessAllowed(undefined, id)).toBe(true);
    expect(businessAllowed(' , ', id)).toBe(true);
  });

  it('con lista, solo esos, sin distinguir mayúsculas', () => {
    expect(businessAllowed(`otro, ${id.toLowerCase()}`, id)).toBe(true);
    expect(businessAllowed('otro', id)).toBe(false);
  });
});
