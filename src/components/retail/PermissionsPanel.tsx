import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSellers } from '@/hooks/useSellers';
import type { PosPermission } from '@/lib/sellerSession';

type Draft = { max: string; canReturn: boolean; canClose: boolean };

const toDraft = (p: PosPermission): Draft => ({
  max: String(Number(p.max_discount_pct)),
  canReturn: p.can_return,
  canClose: p.can_close_register,
});

/** Permisos por persona (solo el propietario): descuento máximo, devoluciones y cierre de caja. */
export function PermissionsPanel() {
  const { permissions, isSaving, savePermissions } = useSellers();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

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
          Lo que cada persona puede hacer en el TPV sin pedir autorización. Si intenta algo para lo que no tiene
          permiso (un descuento por encima de su máximo, una devolución o cerrar la caja), el TPV pide el PIN de
          alguien que sí lo tenga y queda registrado quién lo autorizó. Quien no puede cerrar caja la cuenta a ciegas.
          Solo el propietario cambia los permisos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {permissions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay personas en el TPV.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead className="w-40">Descuento máx.</TableHead>
                <TableHead>Devoluciones</TableHead>
                <TableHead>Cerrar caja</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissions.map((p) => {
                const d = drafts[p.employee_id] ?? toDraft(p);
                const max = Number(d.max.replace(',', '.'));
                const validMax = d.max.trim() !== '' && Number.isFinite(max) && max >= 0 && max <= 100;
                const changed =
                  validMax &&
                  (max !== Number(p.max_discount_pct) || d.canReturn !== p.can_return || d.canClose !== p.can_close_register);
                const set = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [p.employee_id]: { ...d, ...patch } }));
                return (
                  <TableRow key={p.employee_id}>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.is_owner && (
                        <Badge variant="secondary" className="ml-2">
                          Propietario
                        </Badge>
                      )}
                    </TableCell>
                    {p.is_owner ? (
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
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
                        <TableCell>
                          <Switch
                            checked={d.canReturn}
                            onCheckedChange={(v) => set({ canReturn: v })}
                            aria-label={`Devoluciones de ${p.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={d.canClose}
                            onCheckedChange={(v) => set({ canClose: v })}
                            aria-label={`Cerrar caja de ${p.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={changed ? 'default' : 'outline'}
                            disabled={!changed || isSaving}
                            onClick={() => void savePermissions(p.employee_id, max, d.canReturn, d.canClose)}
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
        )}
      </CardContent>
    </Card>
  );
}
