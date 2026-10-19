import { describe, expect, it } from 'vitest';
import { actionLabel, changedFields, formatValue } from '@/lib/adminActivity';

describe('adminActivity', () => {
  it('changedFields devuelve solo lo que cambia en un UPDATE y oculta los campos técnicos', () => {
    const cambios = changedFields({
      action: 'UPDATE',
      old_data: { id: '1', business_id: 'b', plan_id: 'trial', status: 'trialing', updated_at: 'x' },
      new_data: { id: '1', business_id: 'b', plan_id: 'pro', status: 'trialing', updated_at: 'y' },
    });
    expect(cambios).toEqual([{ field: 'plan_id', before: 'trial', after: 'pro' }]);
  });

  it('changedFields lista todos los campos en un INSERT o un DELETE', () => {
    expect(changedFields({ action: 'INSERT', old_data: null, new_data: { id: '1', role: 'super_admin' } }))
      .toEqual([{ field: 'role', before: undefined, after: 'super_admin' }]);
    expect(changedFields({ action: 'DELETE', old_data: { id: '1', name: 'TUILUS' }, new_data: null }))
      .toEqual([{ field: 'name', before: 'TUILUS', after: undefined }]);
  });

  it('actionLabel describe la acción en lenguaje claro', () => {
    expect(actionLabel({ action: 'UPDATE', table_name: 'subscriptions', old_data: { plan_id: 'a' }, new_data: { plan_id: 'b' } }))
      .toBe('Cambio de plan');
    expect(actionLabel({ action: 'UPDATE', table_name: 'subscriptions', old_data: { trial_ends_at: 'a' }, new_data: { trial_ends_at: 'b' } }))
      .toBe('Prueba ampliada');
    expect(actionLabel({ action: 'INSERT', table_name: 'platform_roles', old_data: null, new_data: {} })).toBe('Super admin asignado');
    expect(actionLabel({ action: 'DELETE', table_name: 'businesses', old_data: {}, new_data: null })).toBe('Negocio eliminado');
    expect(actionLabel({ action: 'UPDATE', table_name: 'business_modules', old_data: { is_enabled: true }, new_data: { is_enabled: false } }))
      .toBe('Módulo desactivado');
    expect(actionLabel({ action: 'UPDATE', table_name: 'otra_tabla', old_data: {}, new_data: {} })).toBe('UPDATE en otra_tabla');
  });

  it('formatValue muestra valores legibles', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('sí');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue('texto')).toBe('texto');
  });
});
