// Lógica pura de la pantalla Actividad del panel de super admin.

export interface PlatformAuditEntry {
  id: string;
  created_at: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  table_name: string;
  record_id: string | null;
  business_id: string | null;
  business_name: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  reason: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

/** Campos que no aportan nada al lector. */
const CAMPOS_OCULTOS = new Set(['id', 'created_at', 'updated_at', 'business_id', 'user_id']);

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Campos que cambian entre old_data y new_data (o todos, en un alta o una baja). */
export function changedFields(entry: Pick<PlatformAuditEntry, 'action' | 'old_data' | 'new_data'>): FieldChange[] {
  const before = entry.old_data ?? {};
  const after = entry.new_data ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const cambios: FieldChange[] = [];
  for (const field of keys) {
    if (CAMPOS_OCULTOS.has(field)) continue;
    const a = before[field];
    const b = after[field];
    if (entry.action === 'UPDATE' && JSON.stringify(a) === JSON.stringify(b)) continue;
    cambios.push({ field, before: a, after: b });
  }
  return cambios.sort((x, y) => x.field.localeCompare(y.field));
}

const TABLAS: Record<string, { INSERT: string; UPDATE: string; DELETE: string }> = {
  subscriptions: { INSERT: 'Suscripción creada', UPDATE: 'Suscripción modificada', DELETE: 'Suscripción eliminada' },
  business_modules: { INSERT: 'Módulo activado', UPDATE: 'Módulo modificado', DELETE: 'Módulo retirado' },
  platform_roles: { INSERT: 'Super admin asignado', UPDATE: 'Rol de plataforma modificado', DELETE: 'Super admin retirado' },
  businesses: { INSERT: 'Negocio creado', UPDATE: 'Negocio modificado', DELETE: 'Negocio eliminado' },
  business_members: { INSERT: 'Miembro añadido', UPDATE: 'Miembro modificado', DELETE: 'Miembro eliminado' },
  business_invitations: { INSERT: 'Invitación creada', UPDATE: 'Invitación modificada', DELETE: 'Invitación eliminada' },
  business_settings: { INSERT: 'Ajustes creados', UPDATE: 'Ajustes modificados', DELETE: 'Ajustes eliminados' },
  shopify_connections: { INSERT: 'Shopify vinculado', UPDATE: 'Conexión Shopify modificada', DELETE: 'Shopify desvinculado' },
};

/** Etiqueta legible de una entrada de auditoría. */
export function actionLabel(entry: Pick<PlatformAuditEntry, 'action' | 'table_name' | 'old_data' | 'new_data'>): string {
  const porTabla = TABLAS[entry.table_name];
  if (entry.table_name === 'subscriptions' && entry.action === 'UPDATE') {
    const cambios = changedFields(entry).map((c) => c.field);
    if (cambios.includes('plan_id')) return 'Cambio de plan';
    if (cambios.includes('status')) return 'Cambio de estado de suscripción';
    if (cambios.includes('trial_ends_at')) return 'Prueba ampliada';
  }
  if (entry.table_name === 'business_modules' && entry.action === 'UPDATE') {
    const enabled = entry.new_data?.is_enabled;
    if (typeof enabled === 'boolean') return enabled ? 'Módulo activado' : 'Módulo desactivado';
  }
  if (porTabla) return porTabla[entry.action as 'INSERT' | 'UPDATE' | 'DELETE'] ?? `${entry.action} en ${entry.table_name}`;
  return `${entry.action} en ${entry.table_name}`;
}

/** Texto corto de un valor para la columna Detalle. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString('es-ES');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
