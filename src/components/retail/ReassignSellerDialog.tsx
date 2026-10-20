import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSellers } from '@/hooks/useSellers';

const NONE = '__none__';

interface ReassignSellerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: { id: string; number: string; sellerEmployeeId: string | null } | null;
  onCompleted?: () => void;
}

/** Un admin cambia el vendedor de una venta, con motivo; queda en sale_seller_changes. */
export function ReassignSellerDialog({ open, onOpenChange, sale, onCompleted }: ReassignSellerDialogProps) {
  const { employees, reassignSale, isSaving } = useSellers();
  const [employeeId, setEmployeeId] = useState<string>(NONE);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setEmployeeId(sale?.sellerEmployeeId ?? NONE);
      setReason('');
    }
  }, [open, sale?.sellerEmployeeId]);

  const submit = async () => {
    if (!sale) return;
    const ok = await reassignSale(sale.id, employeeId === NONE ? null : employeeId, reason.trim());
    if (ok) {
      onOpenChange(false);
      onCompleted?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar el vendedor de {sale?.number}</DialogTitle>
          <DialogDescription>El cambio queda registrado con tu nombre y el motivo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Vendedor</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin vendedor</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                    {!e.is_active ? ' (inactivo)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reassign-reason">Motivo</Label>
            <Textarea
              id="reassign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Por ejemplo: la atendió Ana y cobró con la sesión de Juan"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isSaving || reason.trim().length < 3}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
