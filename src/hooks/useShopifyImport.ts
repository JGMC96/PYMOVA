import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from 'sonner';
import { fetchShopifyProducts, fetchAllShopifyProducts, type ShopifyProduct } from '@/lib/shopify';
import { buildVariantIndex, matchVariant, type LocalVariant } from '@/lib/variantMapping';

export interface SyncRun {
  id: string;
  scope: string;
  status: string;
  created_count: number;
  updated_count: number;
  failed_count: number;
  total_count: number;
  processed_count: number;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface SyncIssue {
  id: string;
  run_id: string;
  entity_type: string;
  entity_name: string;
  external_id: string | null;
  attempts: number;
  error_message: string;
  resolved: boolean;
  created_at: string;
}

export interface ImportSummary {
  created: number;
  updated: number;
  variants: number;
  failed: number;
  retried: number;
}

export type QueueItemStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed';

export interface QueueItem {
  id: string;
  name: string;
  status: QueueItemStatus;
  attempts: number;
  error: string | null;
}

export interface QueueState {
  items: QueueItem[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  phase: 'idle' | 'fetching' | 'processing' | 'done';
}

const MAX_ATTEMPTS = 3;
const emptyQueue: QueueState = {
  items: [],
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  phase: 'idle',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hasRealVariants(product: ShopifyProduct) {
  const variants = product.variants.edges.map((e) => e.node);
  return variants.length > 1 || (variants[0] && variants[0].title !== 'Default Title');
}

export function useShopifyImport() {
  const { activeBusinessId, user } = useBusiness();

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [queue, setQueue] = useState<QueueState>(emptyQueue);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const requestIdRef = useRef(0);
  const cancelRef = useRef(false);

  const search = useCallback(async (query: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchShopifyProducts({ first: 50, query });
      if (requestId !== requestIdRef.current) return;
      setProducts(page.products);
      setHasNextPage(page.hasNextPage);
      setCursor(page.endCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setError(message);
      setProducts([]);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async (query: string) => {
    if (!hasNextPage || !cursor) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const page = await fetchShopifyProducts({ first: 50, after: cursor, query });
      if (requestId !== requestIdRef.current) return;
      setProducts((prev) => [...prev, ...page.products]);
      setHasNextPage(page.hasNextPage);
      setCursor(page.endCursor);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [cursor, hasNextPage]);

  /** Sincroniza un producto (y sus variantes). Lanza excepción si algo falla. */
  const syncSingleProduct = useCallback(
    async (
      product: ShopifyProduct,
      businessId: string,
      onVariant: () => void,
      onIssue: (issue: { entity_type: string; entity_name: string; external_id: string | null; error_message: string }) => void,
    ): Promise<'created' | 'updated'> => {
      const variants = product.variants.edges.map((e) => e.node);
      const firstVariant = variants[0];
      const price = Number(product.priceRange.minVariantPrice.amount) || 0;
      const productStock = variants.reduce(
        (sum, v) => sum + (typeof v.quantityAvailable === 'number' ? v.quantityAvailable : 0),
        0,
      );
      const tracksStock = variants.some((v) => typeof v.quantityAvailable === 'number');

      const payload = {
        business_id: businessId,
        name: product.title,
        description: product.description?.slice(0, 2000) || null,
        price,
        category: product.productType || null,
        sku: firstVariant?.sku || null,
        barcode: firstVariant?.barcode || null,
        ...(tracksStock
          ? { track_inventory: true, stock_quantity: productStock }
          : {}),
        is_active: true,
        external_id: product.id,
        external_source: 'shopify',
      };

      const { data: byExternal } = await supabase
        .from('products')
        .select('id')
        .eq('business_id', businessId)
        .eq('external_source', 'shopify')
        .eq('external_id', product.id)
        .maybeSingle();

      const existing =
        byExternal ??
        (
          await supabase
            .from('products')
            .select('id')
            .eq('business_id', businessId)
            .eq('name', product.title)
            .maybeSingle()
        ).data;

      let productId: string;
      let outcome: 'created' | 'updated';

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('products')
          .update(payload)
          .eq('id', existing.id)
          .eq('business_id', businessId);
        if (updateError) throw new Error(updateError.message);
        productId = existing.id;
        outcome = 'updated';
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('products')
          .insert({ ...payload, created_by: user?.id ?? null })
          .select('id')
          .single();
        if (insertError) throw new Error(insertError.message);
        productId = inserted.id;
        outcome = 'created';
      }

      if (hasRealVariants(product)) {
        const { data: currentVariants } = await supabase
          .from('product_variants')
          .select('id, product_id, name, sku, barcode, stock_quantity, external_id')
          .eq('business_id', businessId)
          .eq('product_id', productId);

        const variantIndex = buildVariantIndex((currentVariants ?? []) as LocalVariant[]);

        for (const variant of variants) {
          const attributes = Object.fromEntries(
            variant.selectedOptions.map((o) => [o.name, o.value]),
          );
          const variantPayload = {
            business_id: businessId,
            product_id: productId,
            name: variant.title,
            attributes,
            sku: variant.sku || null,
            barcode: variant.barcode || null,
            price: Number(variant.price.amount) || null,
            is_active: variant.availableForSale,
            ...(typeof variant.quantityAvailable === 'number'
              ? { stock_quantity: variant.quantityAvailable }
              : {}),
            external_id: variant.id,
            external_source: 'shopify',
          };

          const currentId = matchVariant(variantIndex, {
            externalId: variant.id,
            sku: variant.sku,
            barcode: variant.barcode,
            name: variant.title,
          }).variant?.id;
          const { error: variantError } = currentId
            ? await supabase
                .from('product_variants')
                .update(variantPayload)
                .eq('id', currentId)
                .eq('business_id', businessId)
            : await supabase
                .from('product_variants')
                .insert({ ...variantPayload, created_by: user?.id ?? null });

          if (variantError) {
            onIssue({
              entity_type: 'variant',
              entity_name: `${product.title} · ${variant.title}`,
              external_id: variant.id,
              error_message: variantError.message,
            });
          } else {
            onVariant();
          }
        }
      }

      return outcome;
    },
    [user?.id],
  );

  const importProducts = useCallback(
    async (selected: ShopifyProduct[]): Promise<ImportSummary | null> => {
      if (!activeBusinessId) {
        toast.error('Selecciona un negocio activo antes de importar.');
        return null;
      }
      if (selected.length === 0) return null;

      setIsImporting(true);
      const summary: ImportSummary = { created: 0, updated: 0, variants: 0, failed: 0, retried: 0 };

      try {
        for (const product of selected) {
          try {
            const outcome = await syncSingleProduct(
              product,
              activeBusinessId,
              () => {
                summary.variants += 1;
              },
              () => {},
            );
            summary[outcome] += 1;
          } catch (err) {
            console.error('Error importando producto de Shopify:', product.title, err);
            summary.failed += 1;
          }
        }

        setLastSummary(summary);
        if (summary.failed > 0) {
          toast.warning(
            `Importación parcial: ${summary.created} creados, ${summary.updated} actualizados, ${summary.failed} con error.`,
          );
        } else {
          toast.success(
            `Importados ${summary.created + summary.updated} productos (${summary.variants} variantes).`,
          );
        }
        return summary;
      } finally {
        setIsImporting(false);
      }
    },
    [activeBusinessId, syncSingleProduct],
  );

  const fetchRuns = useCallback(async () => {
    if (!activeBusinessId) return;
    const { data } = await supabase
      .from('integration_sync_runs')
      .select(
        'id, scope, status, created_count, updated_count, failed_count, total_count, processed_count, message, started_at, finished_at',
      )
      .eq('business_id', activeBusinessId)
      .eq('integration_key', 'shopify')
      .order('started_at', { ascending: false })
      .limit(5);
    setRuns((data ?? []) as SyncRun[]);
  }, [activeBusinessId]);

  const fetchIssues = useCallback(
    async (runId: string) => {
      if (!activeBusinessId) return;
      const { data } = await supabase
        .from('integration_sync_issues')
        .select('id, run_id, entity_type, entity_name, external_id, attempts, error_message, resolved, created_at')
        .eq('business_id', activeBusinessId)
        .eq('run_id', runId)
        .order('created_at', { ascending: true });
      setIssues((data ?? []) as SyncIssue[]);
    },
    [activeBusinessId],
  );

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const cancelSync = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const forceSync = useCallback(
    async (query = '') => {
      if (!activeBusinessId) {
        toast.error('Selecciona un negocio activo antes de sincronizar.');
        return;
      }
      cancelRef.current = false;
      setIsSyncing(true);
      setSyncProgress(0);
      setIssues([]);
      setQueue({ ...emptyQueue, phase: 'fetching' });

      const { data: run } = await supabase
        .from('integration_sync_runs')
        .insert({
          business_id: activeBusinessId,
          integration_key: 'shopify',
          scope: query ? `catalogo:${query}` : 'catalogo-completo',
          status: 'running',
          created_by: user?.id ?? null,
        })
        .select('id')
        .single();

      const summary: ImportSummary = { created: 0, updated: 0, variants: 0, failed: 0, retried: 0 };
      const pendingIssues: {
        entity_type: string;
        entity_name: string;
        external_id: string | null;
        attempts: number;
        error_message: string;
        resolved: boolean;
      }[] = [];

      try {
        const all = await fetchAllShopifyProducts(query, setSyncProgress);

        setQueue({
          items: all.map((p) => ({
            id: p.id,
            name: p.title,
            status: 'pending' as QueueItemStatus,
            attempts: 0,
            error: null,
          })),
          total: all.length,
          processed: 0,
          succeeded: 0,
          failed: 0,
          phase: 'processing',
        });

        if (run) {
          await supabase
            .from('integration_sync_runs')
            .update({ total_count: all.length })
            .eq('id', run.id);
        }

        const updateItem = (id: string, patch: Partial<QueueItem>) =>
          setQueue((prev) => ({
            ...prev,
            items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          }));

        let processed = 0;
        for (const product of all) {
          if (cancelRef.current) break;

          let attempt = 0;
          let lastError: string | null = null;
          let done = false;

          while (attempt < MAX_ATTEMPTS && !done) {
            attempt += 1;
            updateItem(product.id, {
              status: attempt === 1 ? 'running' : 'retrying',
              attempts: attempt,
            });
            try {
              const outcome = await syncSingleProduct(
                product,
                activeBusinessId,
                () => {
                  summary.variants += 1;
                },
                (issue) => pendingIssues.push({ ...issue, attempts: attempt, resolved: false }),
              );
              summary[outcome] += 1;
              if (attempt > 1) summary.retried += 1;
              done = true;
              lastError = null;
            } catch (err) {
              lastError = err instanceof Error ? err.message : 'Error desconocido';
              if (attempt < MAX_ATTEMPTS) await sleep(400 * 2 ** (attempt - 1));
            }
          }

          processed += 1;
          if (done) {
            updateItem(product.id, { status: 'done', error: null });
            if (attempt > 1) {
              pendingIssues.push({
                entity_type: 'product',
                entity_name: product.title,
                external_id: product.id,
                attempts: attempt,
                error_message: `Resuelto tras ${attempt} intentos`,
                resolved: true,
              });
            }
          } else {
            summary.failed += 1;
            updateItem(product.id, { status: 'failed', error: lastError });
            pendingIssues.push({
              entity_type: 'product',
              entity_name: product.title,
              external_id: product.id,
              attempts: attempt,
              error_message: lastError ?? 'Error desconocido',
              resolved: false,
            });
          }

          setQueue((prev) => ({
            ...prev,
            processed,
            succeeded: done ? prev.succeeded + 1 : prev.succeeded,
            failed: done ? prev.failed : prev.failed + 1,
          }));

          if (run && processed % 10 === 0) {
            await supabase
              .from('integration_sync_runs')
              .update({ processed_count: processed })
              .eq('id', run.id);
          }
        }

        setLastSummary(summary);
        setQueue((prev) => ({ ...prev, phase: 'done' }));

        if (run) {
          if (pendingIssues.length > 0) {
            await supabase.from('integration_sync_issues').insert(
              pendingIssues.map((issue) => ({
                ...issue,
                business_id: activeBusinessId,
                run_id: run.id,
              })),
            );
          }
          await supabase
            .from('integration_sync_runs')
            .update({
              status: cancelRef.current ? 'cancelled' : summary.failed > 0 ? 'partial' : 'success',
              created_count: summary.created,
              updated_count: summary.updated,
              failed_count: summary.failed,
              total_count: all.length,
              processed_count: processed,
              message: `${processed}/${all.length} productos procesados (${summary.variants} variantes${
                summary.retried > 0 ? `, ${summary.retried} resueltos tras reintento` : ''
              }).`,
              finished_at: new Date().toISOString(),
            })
            .eq('id', run.id);
          await fetchIssues(run.id);
        }

        if (summary.failed > 0) {
          toast.warning(`Sincronización con ${summary.failed} incidencias. Revisa el detalle.`);
        } else if (cancelRef.current) {
          toast.info('Sincronización cancelada.');
        } else {
          toast.success(`Catálogo sincronizado: ${summary.created + summary.updated} productos.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        toast.error(`Error sincronizando con Shopify: ${message}`);
        setQueue((prev) => ({ ...prev, phase: 'done' }));
        if (run) {
          await supabase
            .from('integration_sync_runs')
            .update({ status: 'error', message, finished_at: new Date().toISOString() })
            .eq('id', run.id);
        }
      } finally {
        cancelRef.current = false;
        setIsSyncing(false);
        fetchRuns();
      }
    },
    [activeBusinessId, user?.id, fetchRuns, fetchIssues, syncSingleProduct],
  );

  return {
    products,
    runs,
    issues,
    queue,
    isSyncing,
    syncProgress,
    forceSync,
    cancelSync,
    fetchIssues,
    isLoading,
    isImporting,
    error,
    hasNextPage,
    lastSummary,
    search,
    loadMore,
    importProducts,
  };
}
