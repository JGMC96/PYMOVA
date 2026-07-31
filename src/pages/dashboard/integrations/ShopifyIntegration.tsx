import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Webhook,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useShopifyImport } from '@/hooks/useShopifyImport';
import { useShopifyOrdersSync } from '@/hooks/useShopifyOrdersSync';
import { SHOPIFY_STORE_PERMANENT_DOMAIN } from '@/lib/shopify';
import { SyncQueuePanel } from '@/components/integrations/SyncQueuePanel';
import { VariantMappingReport } from '@/components/integrations/VariantMappingReport';

const ShopifyIntegration = () => {
  const {
    products,
    runs,
    issues,
    queue,
    cancelSync,
    fetchIssues,
    isSyncing,
    syncProgress,
    forceSync,
    isLoading,
    isImporting,
    error,
    hasNextPage,
    lastSummary,
    search,
    loadMore,
    importProducts,
  } = useShopifyImport();

  const {
    connection,
    isSyncing: isOrdersSyncing,
    isRegistering,
    lastSummary: ordersSummary,
    syncOrders,
    registerWebhooks,
  } = useShopifyOrdersSync();



  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    search('');
  }, [search]);

  const allSelected = products.length > 0 && selected.size === products.length;

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSelected(new Set());
    setAppliedTerm(term);
    search(term);
  };

  const handleImport = async () => {
    const result = await importProducts(selectedProducts);
    if (result) setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
            <Link to="/dashboard/integrations">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Integraciones
            </Link>
          </Button>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-accent" />
            Shopify
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <Store className="w-4 h-4" />
            {SHOPIFY_STORE_PERMANENT_DOMAIN}
            <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
              Conectada
            </Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => forceSync(appliedTerm)}
            disabled={isSyncing || isImporting}
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {isSyncing
              ? queue.phase === 'processing'
                ? `Sincronizando… (${queue.processed}/${queue.total})`
                : `Descargando… (${syncProgress})`
              : 'Forzar sincronización'}
          </Button>
        <Button onClick={handleImport} disabled={isImporting || selected.size === 0}>
          {isImporting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Importar {selected.size > 0 ? `(${selected.size})` : 'seleccionados'}
        </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sincronización</CardTitle>
          <CardDescription>
            «Forzar sincronización» recorre todo el catálogo de Shopify (o el filtro de búsqueda
            aplicado) y actualiza productos, variantes, precios y stock en Pymova. Los pedidos y
            ventas de Shopify se gestionan desde Retail → E-commerce.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no has lanzado ninguna sincronización.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runs.map((run) => (
                <li
                  key={run.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => fetchIssues(run.id)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchIssues(run.id)}
                  className="flex items-center justify-between gap-3 border-b pb-2 last:border-0 cursor-pointer hover:text-foreground"
                >
                  <span className="text-muted-foreground">
                    {new Date(run.started_at).toLocaleString('es-ES')} · {run.scope}
                  </span>
                  <span className="flex items-center gap-2">
                    <span>
                      {run.processed_count > 0 ? `${run.processed_count}/${run.total_count} · ` : ''}
                      {run.created_count} nuevos · {run.updated_count} actualizados
                      {run.failed_count > 0 ? ` · ${run.failed_count} con error` : ''}
                    </span>
                    <Badge
                      variant={run.status === 'success' ? 'default' : run.status === 'error' ? 'destructive' : 'secondary'}
                    >
                      {run.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <VariantMappingReport query={appliedTerm} />

      <SyncQueuePanel
        queue={queue}
        issues={issues}
        isSyncing={isSyncing}
        fetchedCount={syncProgress}
        onCancel={cancelSync}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pedidos de Shopify</CardTitle>
          <CardDescription>
            Importa los pedidos de tu tienda con la Admin API y actívalos en tiempo real con avisos
            automáticos (webhooks). Los pedidos aparecerán en Retail → E-commerce, donde podrás
            aceptarlos, prepararlos, enviarlos (crea el fulfillment en Shopify) o cancelarlos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => syncOrders(30)} disabled={isOrdersSyncing}>
              {isOrdersSyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar pedidos (30 días)
            </Button>
            <Button variant="outline" onClick={() => syncOrders(365)} disabled={isOrdersSyncing}>
              Último año
            </Button>
            <Button variant="outline" onClick={registerWebhooks} disabled={isRegistering}>
              {isRegistering ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Webhook className="w-4 h-4 mr-2" />
              )}
              {connection?.webhooks_registered_at ? 'Reactivar avisos' : 'Activar avisos automáticos'}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              Avisos automáticos:{' '}
              {connection?.webhooks_registered_at ? (
                <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                  Activos desde {new Date(connection.webhooks_registered_at).toLocaleString('es-ES')}
                </Badge>
              ) : (
                <Badge variant="secondary">Sin activar</Badge>
              )}
            </p>
            <p>
              Última sincronización de pedidos:{' '}
              {connection?.last_orders_sync_at
                ? new Date(connection.last_orders_sync_at).toLocaleString('es-ES')
                : 'nunca'}
            </p>
            {ordersSummary && (
              <p>
                Último resultado: {ordersSummary.created} nuevos · {ordersSummary.updated}{' '}
                actualizados
                {ordersSummary.failed > 0 ? ` · ${ordersSummary.failed} con error` : ''}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>



      {lastSummary && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="py-4 text-sm text-foreground">
            Última importación: <strong>{lastSummary.created}</strong> creados,{' '}
            <strong>{lastSummary.updated}</strong> actualizados,{' '}
            <strong>{lastSummary.variants}</strong> variantes
            {lastSummary.failed > 0 && (
              <>
                , <strong className="text-destructive">{lastSummary.failed}</strong> con error
              </>
            )}
            .
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Catálogo de Shopify</CardTitle>
          <CardDescription>
            Busca por título, proveedor o tipo (p. ej. <code>vendor:Nike</code>) y selecciona los
            productos que quieres traer a tu catálogo de Pymova. Los que ya existan se actualizarán.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar productos en Shopify…"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </form>

          {error && (
            <p className="text-sm text-destructive">
              No se pudo conectar con Shopify: {error}
            </p>
          )}

          {products.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} id="select-all" />
              <label htmlFor="select-all" className="cursor-pointer">
                Seleccionar todos ({products.length} cargados)
              </label>
            </div>
          )}

          {isLoading && products.length === 0 ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              No se han encontrado productos{appliedTerm ? ` para “${appliedTerm}”` : ''}.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => {
                const variants = product.variants.edges.map((e) => e.node);
                const isSelected = selected.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => toggle(product.id)}
                    className={`text-left rounded-xl border p-3 flex gap-3 transition-colors ${
                      isSelected ? 'border-accent bg-accent/5' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <Checkbox checked={isSelected} className="mt-1 pointer-events-none" />
                    <div className="w-14 h-14 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                      {product.featuredImage && (
                        <img
                          src={product.featuredImage.url}
                          alt={product.featuredImage.altText ?? product.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{product.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {Number(product.priceRange.minVariantPrice.amount).toFixed(2)}{' '}
                        {product.priceRange.minVariantPrice.currencyCode}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {product.productType && (
                          <Badge variant="outline" className="text-xs">
                            {product.productType}
                          </Badge>
                        )}
                        {variants.length > 1 && (
                          <Badge variant="secondary" className="text-xs">
                            {variants.length} variantes
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => loadMore(appliedTerm)} disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Cargar más
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ShopifyIntegration;
