import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSalesAccess } from '@/hooks/useSalesAccess';
import { useSellers, type PermissionFlags } from '@/hooks/useSellers';
import type { PosPermission } from '@/lib/sellerSession';

type Draft = PermissionFlags & { max: string };

const FLAGS: Array<{ key: keyof PermissionFlags; label: string }> = [
  { key: 'canReturn', label: 'Devoluciones' },
  { key: 'canClose', label: 'Cerrar caja' },
  { key: 'canEditCatalog', label: 'Productos y precios' },
  { key: 'canSeeCosts', label: 'Ver costes' },
  { key: 'canAdjustStock', label: 'Ajustar stock' },
];

const toDraft = (p: PosPermission): Draft => ({
  max: String(Number(p.max_discount_pct)),
  canReturn: p.can_return,
  canClose: p.can_close_register,
  canEditCatalog: p.can_edit_catalog,
  canSeeCosts: p.can_see_costs,
  canAdjustStock: p.can_adjust_stock,
});

/**
 * Permisos por persona (solo el propietario). En el TPV: descuento máximo, devoluciones y
 * cierre de caja (0030). En la gestión, para quien entra con su cuenta: productos y
 * precios, ver costes y ajustar stock (0031), y «Ver ventas» en Informes (0064).
 */
export function PermissionsPanel() {
  const { permissions, isSaving, savePermissions } = useSellers();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const sales = useSalesAccess(true);
  // «Ver ventas» se guarda aparte (otra RPC): aquí, lo cambiado y aún sin guardar.
  const [salesDrafts, setSalesDrafts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(permissions.map((p) => [p.employee_id, toDraft(p)])));
  }, [permissions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Permisos
        </CardTitle>
        <CardDescription>
          En el TPV: si alguien intenta algo para lo que no tiene permiso (un descuento por encima de su máximo, una
          devolución o cerrar la caja), se pide el PIN de alguien que sí lo tenga y queda registrado quién lo autorizó;
          quien no puede cerrar caja la cuenta a ciegas. «Cerrar caja» también permite apuntar gastos, entradas y retiradas de caja. En la gestión: «Productos y precios», «Ver costes» y «Ajustar
          stock» se aplican a quien entra con su propia cuenta. «Ver ventas» abre Informes (ventas de tienda y online)
          a quien entra con su propia cuenta; no se lo des a la cuenta compartida del TPV. Solo el propietario cambia
          los permisos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {permissions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay personas en el TPV.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead className="w-36">Descuento máx.</TableHead>
                  {FLAGS.map((f) => (
                    <TableHead key={f.key} className="text-center">
                      {f.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Ver ventas</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((p) => {
                  const original = toDraft(p);
                  const d = drafts[p.employee_id] ?? original;
                  const max = Number(d.max.replace(',', '.'));
                  const validMax = d.max.trim() !== '' && Number.isFinite(max) && max >= 0 && max <= 100;
                  const permsChanged =
                    validMax && (max !== Number(p.max_discount_pct) || FLAGS.some((f) => d[f.key] !== original[f.key]));
                  const seesSales = sales.allowed?.includes(p.employee_id) ?? false;
                  const salesDraft = salesDrafts[p.employee_id] ?? seesSales;
                  const salesChanged = salesDraft !== seesSales;
                  const changed = validMax && (permsChanged || salesChanged);
                  const save = async () => {
                    if (permsChanged) {
                      const { max: _max, ...flags } = d;
                      await savePermissions(p.employee_id, max, flags);
                    }
                    if (salesChanged) {
                      // El aviso de error ya lo muestra el hook.
                      await sales.setAccess(p.employee_id, salesDraft).catch(() => undefined);
                      setSalesDrafts(({ [p.employee_id]: _done, ...rest }) => rest);
                    }
                  };
                  const set = (patch: Partial<Draft>) =>
                    setDrafts((all) => ({ ...all, [p.employee_id]: { ...d, ...patch } }));
                  return (
                    <TableRow key={p.employee_id}>
                      <TableCell className="font-medium">
                        {p.name}
                        {p.is_owner && (
                          <Badge variant="secondary" className="ml-2">
                            Propietario
                          </Badge>
                        )}
                        {!p.has_account && !p.is_owner && (
                          <span className="block text-xs text-muted-foreground">Solo TPV</span>
                        )}
                      </TableCell>
                      {p.is_owner ? (
                        <TableCell colSpan={FLAGS.length + 3} className="text-sm text-muted-foreground">
                          Todo, siempre: los permisos de un propietario no se pueden cambiar.
                        </TableCell>
                      ) : (
                        <>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="1"
                                inputMode="decimal"
                                value={d.max}
                                onChange={(e) => set({ max: e.target.value })}
                                className="h-8 w-20 text-right"
                                aria-label={`Descuento máximo de ${p.name}`}
                              />
                              <span className="text-sm text-muted-foreground">%</span>
                            </div>
                          </TableCell>
                          {FLAGS.map((f) => (
                            <TableCell key={f.key} className="text-center">
                              <Switch
                                checked={d[f.key]}
                                onCheckedChange={(v) => set({ [f.key]: v } as Partial<Draft>)}
                                aria-label={`${f.label} de ${p.name}`}
                              />
                            </TableCell>
                          ))}
                          <TableCell className="text-center">
                            <Switch
                              checked={salesDraft}
                              disabled={!p.has_account || !sales.allowed}
                              onCheckedChange={(v) => setSalesDrafts((all) => ({ ...all, [p.employee_id]: v }))}
                              aria-label={`Ver ventas de ${p.name}`}
                            />
                            {!p.has_account && (
                              <span className="block text-xs text-muted-foreground">Necesita su cuenta</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={changed ? 'default' : 'outline'}
                              disabled={!changed || isSaving || sales.isSaving}
                              onClick={() => void save()}
                            >
                              Guardar
                            </Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
