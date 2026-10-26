import { describe, expect, it } from 'vitest';
import { isMenuItemActive, MENU_SECTIONS, visibleMenu, type MenuAccess } from '@/lib/dashboardMenu';
import type { ModuleKey } from '@/types/database';

const TODOS: ModuleKey[] = ['clients', 'products', 'invoicing', 'payments', 'ai_advisor', 'reports', 'retail', 'marketing', 'hr'];

const etiquetas = (access: MenuAccess) =>
  visibleMenu(MENU_SECTIONS, access).map((s) => [s.title ?? '', s.items.map((i) => (i.locked ? `${i.label} 🔒` : i.label))]);

describe('menú por áreas', () => {
  it('el propietario con todo el plan ve todas las áreas y entradas, sin candados', () => {
    expect(etiquetas({ enabledModules: TODOS, isAdmin: true, isOwner: true, canAdjustStock: true })).toEqual([
      ['', ['Inicio']],
      ['Ventas', ['TPV', 'Caja', 'Historial', 'Pedidos web']],
      ['Productos y stock', ['Productos', 'Inventario', 'Compras', 'Etiquetas']],
      ['Clientes', ['Clientes']],
      ['Facturación', ['Facturas', 'Cobros']],
      ['Marketing', ['Marketing']],
      ['Equipo', ['RRHH', 'Vendedores']],
      ['Informes', ['Informes']],
      ['', ['Asesor IA']],
    ]);
  });

  it('sin permiso, la entrada no se ve (ni con candado)', () => {
    const menu = etiquetas({ enabledModules: TODOS, isAdmin: false, isOwner: false, canAdjustStock: false });
    const todas = menu.flatMap(([, items]) => items);
    expect(todas).not.toContain('Compras');
    expect(todas).not.toContain('Vendedores');
    expect(menu).toContainEqual(['Equipo', ['RRHH']]);
    expect(menu.map(([title]) => title)).not.toContain('Facturación');
  });

  it('Informes solo lo ve el propietario: ni el administrador ni el personal', () => {
    const titulos = (access: MenuAccess) => etiquetas(access).map(([title]) => title);
    expect(titulos({ enabledModules: TODOS, isAdmin: true, isOwner: true, canAdjustStock: true })).toContain('Informes');
    expect(titulos({ enabledModules: TODOS, isAdmin: true, isOwner: false, canAdjustStock: true })).not.toContain('Informes');
    expect(titulos({ enabledModules: TODOS, isAdmin: false, isOwner: false, canAdjustStock: false })).not.toContain('Informes');
  });

  it('lo que no entra en el plan sale con candado', () => {
    const menu = etiquetas({ enabledModules: ['clients', 'products'], isAdmin: true, isOwner: true, canAdjustStock: true });
    expect(menu).toContainEqual(['Ventas', ['TPV 🔒', 'Caja 🔒', 'Historial 🔒', 'Pedidos web 🔒']]);
    expect(menu).toContainEqual(['Productos y stock', ['Productos', 'Inventario 🔒', 'Compras 🔒', 'Etiquetas 🔒']]);
  });

  it('un área sin entradas visibles desaparece', () => {
    const sinEquipo = MENU_SECTIONS.map((s) =>
      s.title === 'Equipo' ? { ...s, items: s.items.filter((i) => i.label === 'Vendedores') } : s,
    );
    const menu = visibleMenu(sinEquipo, { enabledModules: TODOS, isAdmin: false, isOwner: false, canAdjustStock: false });
    expect(menu.map((s) => s.title)).not.toContain('Equipo');
  });

  it('Inicio solo está activo en /dashboard; el resto también en sus subrutas', () => {
    expect(isMenuItemActive('/dashboard', '/dashboard')).toBe(true);
    expect(isMenuItemActive('/dashboard', '/dashboard/sales/pos')).toBe(false);
    expect(isMenuItemActive('/dashboard/clients', '/dashboard/clients/123')).toBe(true);
    expect(isMenuItemActive('/dashboard/sales/pos', '/dashboard/sales/posx')).toBe(false);
  });
});
