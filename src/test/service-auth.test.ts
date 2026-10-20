import { describe, expect, it } from 'vitest';
import { isServiceRoleRequest, jwtRole } from '../../supabase/functions/_shared/service-auth';

const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma`;

describe('jwtRole e isServiceRoleRequest', () => {
  it('reconoce un token de servicio', () => {
    const header = `Bearer ${token({ role: 'service_role', iss: 'supabase' })}`;
    expect(jwtRole(header)).toBe('service_role');
    expect(isServiceRoleRequest(header)).toBe(true);
  });

  it('un token de usuario no es de servicio', () => {
    const header = `Bearer ${token({ role: 'authenticated', sub: 'u1', name: 'Ñandú ✓' })}`;
    expect(jwtRole(header)).toBe('authenticated');
    expect(isServiceRoleRequest(header)).toBe(false);
  });

  it('sin token o con un token mal formado no hay rol', () => {
    expect(jwtRole(null)).toBeNull();
    expect(jwtRole('')).toBeNull();
    expect(jwtRole('Basic abc')).toBeNull();
    expect(jwtRole('Bearer no-es-un-jwt')).toBeNull();
    expect(jwtRole('Bearer a.###.c')).toBeNull();
    expect(isServiceRoleRequest('Bearer a.b.c')).toBe(false);
  });
});
