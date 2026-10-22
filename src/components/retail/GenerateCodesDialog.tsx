// Códigos para productos nuevos (0043): SKU y EAN-13 para las tallas que no tienen. Nunca
// cambia un código que ya existe. Mientras Stockagile esté conectado, solo vista previa.
import { useEffect, useMemo, useState } from 'react';
import { Barcode, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import type { ProductWithStock } from '@/hooks/useInventory';
import {
  colorCode, DEFAULT_SKU_PATTERN, nextModelNumber, planCodes, seasonCode, typeCode,
} from '@/lib/catalogCodes';

interface Status {
  locked: boolean;
  can_generate: boolean;
  ean_prefix: string;
  sku_pattern: string;
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  try {
    const body = await context?.json();
    if (body?.error) return String(body.error);
  } catch {
    // sin cuerpo JSON
  }
  return error instanceof Error ? error.message : 'No se han podido guardar los códigos';
}

export function GenerateCodesDialog({
  product,
  existingSkus,
  onClose,
  onDone,
}: {
  product: ProductWithStock | null;
  existingSkus: (string | null)[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { activeBusinessId } = useBusiness();
  const [status, setStatus] = useState<Status | null>(null);
  const [temporada, setTemporada] = useState('');
  const [tipo, setTipo] = useState('');
  const [modelo, setModelo] = useState('');
  const [color, setColor] = useState('');
  const [withSku, setWithSku] = useState(true);
  const [withBarcode, setWithBarcode] = useState(true);
  const [previewBarcodes, setPreviewBarcodes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Al abrir: estado del negocio y propuesta inicial.
  useEffect(() => {
    if (!product || !activeBusinessId) return;
    const t = seasonCode();
    const ty = typeCode(product.name);
    setTemporada(t);
    setTipo(ty);
    setModelo(nextModelNumber(existingSkus, t, ty));
    setColor(colorCode(product.color));
    setWithSku(true);
    setWithBarcode(true);
    setStatus(null);
    // RPC de la 0043: `as never` hasta que se regenere types.ts.
    void supabase
      .rpc('catalog_codes_status' as never, { _business_id: activeBusinessId } as never)
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        const rows = data as unknown as Status[] | Status | null;
        setStatus((Array.isArray(rows) ? rows[0] : rows) ?? null);
      });
  }, [product, activeBusinessId, existingSkus]);

  const plan = useMemo(
    () =>
      product
        ? planCodes(
            product.variants,
            {
              pattern: status?.sku_pattern ?? DEFAULT_SKU_PATTERN,
              parts: { temporada, tipo, modelo, color },
              withSku,
              withBarcode,
            },
            existingSkus,
          )
        : [],
    [product, status, temporada, tipo, modelo, color, withSku, withBarcode, existingSkus],
  );
  const barcodeCount = plan.filter((p) => p.barcode).length;

  // Vista previa de los EAN (no reserva nada; al guardar pueden ser otros si alguien se adelanta).
  useEffect(() => {
    if (!activeBusinessId || !status?.can_generate || barcodeCount === 0) {
      setPreviewBarcodes([]);
      return;
    }
    let cancelled = false;
    void supabase
      .rpc('next_barcodes' as never, { _business_id: activeBusinessId, _count: barcodeCount } as never)
      .then(({ data, error }) => {
        if (!cancelled) setPreviewBarcodes(error ? [] : ((data as unknown as string[]) ?? []));
      });
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId, status, barcodeCount]);

  const problems = plan.filter((p) => p.problem).length;
  const canSave = !!status && status.can_generate && !status.locked && plan.length > 0 && problems === 0 && !saving;

  const handleSave = async () => {
    if (!product || !activeBusinessId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('catalog-codes', {
        body: {
          business_id: activeBusinessId,
          product_id: product.id,
          items: plan.map((p) => ({ variant_id: p.variant.id, sku: p.sku, barcode: p.barcode })),
        },
      });
      if (error) throw new Error(await functionError(error));
      const codes = (data as { codes?: unknown[] } | null)?.codes ?? [];
      toast.success(`Códigos guardados en ${codes.length} ${codes.length === 1 ? 'talla' : 'tallas'}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido guardar los códigos');
    } finally {
      setSaving(false);
    }
  };

  let barcodeIndex = 0;
  return (
    <Dialog open={product !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="w-5 h-5" />
            Códigos · {product?.name}
          </DialogTitle>
          <DialogDescription>
            Pone SKU y código de barras a las tallas que no tienen. Los códigos que ya existen no se cambian.
          </DialogDescription>
        </DialogHeader>

        {status?.locked && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Mientras Stockagile esté conectado, los códigos se crean en Stockagile. Esto es solo una vista previa.</span>
          </div>
        )}
        {status && !status.can_generate && (
          <p className="text-sm text-muted-foreground">Necesitas permiso para editar el catálogo para generar códigos.</p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Temporada</Label>
            <Input value={temporada} onChange={(e) => setTemporada(e.target.value.toUpperCase())} placeholder="FW26" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="ZU" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Modelo</Label>
            <Input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="001" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="NE" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Formato: {status?.sku_pattern ?? DEFAULT_SKU_PATTERN}
          {status && <> · serie EAN {status.ean_prefix}…</>}
        </p>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={withSku} onCheckedChange={(v) => setWithSku(v === true)} />
            SKU
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={withBarcode} onCheckedChange={(v) => setWithBarcode(v === true)} />
            Código de barras (EAN-13)
          </label>
        </div>

        {plan.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todas las tallas tienen ya esos códigos.</p>
        ) : (
          <div className="max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Talla</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Código de barras</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.map((p) => {
                  const ean = p.barcode ? previewBarcodes[barcodeIndex++] ?? 'nuevo' : null;
                  return (
                    <TableRow key={p.variant.id}>
                      <TableCell>{p.variant.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.sku ?? <span className="text-muted-foreground">{p.variant.sku || '—'}</span>}
                        {p.problem && <span className="ml-2 font-sans text-destructive">{p.problem}</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {ean ?? <span className="text-muted-foreground">{p.variant.barcode || '—'}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {saving ? 'Guardando…' : 'Guardar códigos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
