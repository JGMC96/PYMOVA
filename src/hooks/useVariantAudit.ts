import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { fetchAllShopifyProducts } from '@/lib/shopify';
import {
  auditProductVariants,
  type LocalVariant,
  type MismatchCode,
  type VariantMismatch,
} from '@/lib/variantMapping';

export interface StoredMismatch extends VariantMismatch {
  id: string;
  resolved: boolean;
  created_at: string;
}

export function useVariantAudit() {
  const { activeBusinessId, user } = useBusiness();
  const [mismatches, setMismatches] = useState<StoredMismatch[]>([]);
  const [isAuditing, setIsAuditing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const fetchMismatches = useCallback(async () => {
    if (!activeBusinessId) return;
    const { data } = await supabase
      .from('integration_variant_mismatches')
      .select(
        'id, product_name, variant_name, sku, barcode, external_id, local_variant_id, issue_code, external_stock, local_stock, details, resolved, created_at',
      )
      .eq('business_id', activeBusinessId)
      .eq('integration_key', 'shopify')
      .order('created_at', { ascending: false })
      .limit(500);
    const rows = (data ?? []) as unknown as StoredMismatch[];
    setMismatches(rows);
    setLastRunAt(rows[0]?.created_at ?? null);
  }, [activeBusinessId]);

  useEffect(() => {
    fetchMismatches();
  }, [fetchMismatches]);

  const runAudit = useCallback(
    async (query = '') => {
      if (!activeBusinessId) {
        toast.error('Selecciona un negocio activo.');
        return;
      }
      setIsAuditing(true);
      setProgress(0);
      try {
        const shopifyProducts = await fetchAllShopifyProducts(activeBusinessId, query, setProgress);

        const { data: localProducts } = await supabase
          .from('products')
          .select('id, name, external_id')
          .eq('business_id', activeBusinessId);
        const { data: localVariants } = await supabase
          .from('product_variants')
          .select('id, product_id, name, sku, barcode, stock_quantity, external_id')
          .eq('business_id', activeBusinessId);

        const productByExternal = new Map(
          (localProducts ?? []).filter((p) => p.external_id).map((p) => [p.external_id as string, p]),
        );
        const productByName = new Map(
          (localProducts ?? []).map((p) => [p.name.trim().toLowerCase(), p]),
        );
        const variantsByProduct = new Map<string, LocalVariant[]>();
        for (const variant of (localVariants ?? []) as LocalVariant[]) {
          const list = variantsByProduct.get(variant.product_id) ?? [];
          list.push(variant);
          variantsByProduct.set(variant.product_id, list);
        }

        const found: VariantMismatch[] = [];
        for (const product of shopifyProducts) {
          const local =
            productByExternal.get(product.id) ??
            productByName.get(product.title.trim().toLowerCase()) ??
            null;
          const localVars = local ? variantsByProduct.get(local.id) ?? [] : [];
          found.push(...auditProductVariants(product, localVars));
        }

        await supabase
          .from('integration_variant_mismatches')
          .delete()
          .eq('business_id', activeBusinessId)
          .eq('integration_key', 'shopify');

        if (found.length > 0) {
          const rows = found.map((m) => ({
            ...m,
            business_id: activeBusinessId,
            integration_key: 'shopify',
          }));
          for (let i = 0; i < rows.length; i += 200) {
            const { error } = await supabase
              .from('integration_variant_mismatches')
              .insert(rows.slice(i, i + 200));
            if (error) throw new Error(error.message);
          }
        }

        await fetchMismatches();
        if (found.length === 0) {
          toast.success('Sin desajustes: todas las variantes están correctamente mapeadas.');
        } else {
          toast.warning(`${found.length} desajustes detectados en ${shopifyProducts.length} productos.`);
        }
      } catch (err) {
        toast.error(
          `No se pudo validar el mapeo: ${err instanceof Error ? err.message : 'error desconocido'}`,
        );
      } finally {
        setIsAuditing(false);
      }
    },
    [activeBusinessId, fetchMismatches],
  );

  const toggleResolved = useCallback(
    async (id: string, resolved: boolean) => {
      const { error } = await supabase
        .from('integration_variant_mismatches')
        .update({ resolved })
        .eq('id', id);
      if (error) {
        toast.error('No se pudo actualizar el desajuste.');
        return;
      }
      setMismatches((prev) => prev.map((m) => (m.id === id ? { ...m, resolved } : m)));
    },
    [],
  );

  const exportCsv = useCallback(() => {
    const header = [
      'producto',
      'variante',
      'sku',
      'codigo_barras',
      'shopify_id',
      'problema',
      'stock_shopify',
      'stock_pymova',
      'detalle',
      'resuelto',
    ];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const body = mismatches.map((m) =>
      [
        m.product_name,
        m.variant_name,
        m.sku,
        m.barcode,
        m.external_id,
        m.issue_code,
        m.external_stock,
        m.local_stock,
        m.details,
        m.resolved ? 'si' : 'no',
      ]
        .map(escape)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `desajustes-variantes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [mismatches]);

  const countsByCode = mismatches.reduce<Record<string, number>>((acc, m) => {
    if (!m.resolved) acc[m.issue_code] = (acc[m.issue_code] ?? 0) + 1;
    return acc;
  }, {});

  return {
    mismatches,
    countsByCode: countsByCode as Record<MismatchCode, number>,
    isAuditing,
    progress,
    lastRunAt,
    runAudit,
    toggleResolved,
    exportCsv,
    refresh: fetchMismatches,
    userId: user?.id,
  };
}
