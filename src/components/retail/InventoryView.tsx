import { useState } from 'react';
import { Package, RefreshCw, Edit2, Layers, History, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useInventory, type ProductWithStock } from '@/hooks/useInventory';
import { VariantsDialog } from './VariantsDialog';
import { StockMovementsDialog } from './StockMovementsDialog';
import { StockAdjustDialog, type StockAdjustTarget } from './StockAdjustDialog';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { LabelPrintDialog } from '@/components/labels/LabelPrintDialog';
import { labelDataFor } from '@/lib/labels';

export function InventoryView() {
  const { products, isLoading, isUpdating, toggleTracking, refreshProducts } = useInventory();
  // 0031: ajustar stock y cambiar el control de stock, con su permiso.
  const { canAdjustStock, canEditCatalog } = useMyPermissions();
  const [adjustTarget, setAdjustTarget] = useState<StockAdjustTarget | null>(null);
  const [variantProduct, setVariantProduct] = useState<ProductWithStock | null>(null);
  const [historyProduct, setHistoryProduct] = useState<ProductWithStock | null>(null);
  const [labelsProduct, setLabelsProduct] = useState<ProductWithStock | null>(null);
  // Una etiqueta de cada talla (las cantidades se cambian en Comercio › Etiquetas).
  const labelItems = labelsProduct
    ? labelsProduct.variants.length
      ? labelsProduct.variants.filter((v) => v.is_active).map((v) => ({ data: labelDataFor(labelsProduct, v), quantity: 1 }))
      : [{ data: labelDataFor(labelsProduct), quantity: 1 }]
    : [];


  const handleTrackingChange = async (productId: string, checked: boolean) => {
    await toggleTracking(productId, checked);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          Inventario
        </CardTitle>
        <Button variant="outline" size="sm" onClick={refreshProducts}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Actualizar
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No hay productos registrados</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-center">Seguimiento</TableHead>
                <TableHead className="text-center">Variantes</TableHead>
                <TableHead className="text-center">Movimientos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    {product.name}
                    {product.barcode && (
                      <span className="block text-xs text-muted-foreground">{product.barcode}</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {product.category ? (
                      <Badge variant="outline">{product.category}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">${product.price.toFixed(2)}</TableCell>
                  <TableCell>
                    {product.track_inventory ? (
                      <div className="flex items-center justify-center gap-2">
                        <Badge
                          variant={product.stock_quantity > 10 ? 'secondary' : product.stock_quantity > 0 ? 'outline' : 'destructive'}
                          title={product.variants.length > 0 ? 'Suma de las variantes: se ajusta en cada variante' : undefined}
                        >
                          {product.stock_quantity}
                        </Badge>
                        {canAdjustStock && product.variants.length === 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Ajustar stock"
                            onClick={() =>
                              setAdjustTarget({
                                productId: product.id,
                                variantId: null,
                                name: product.name,
                                current: product.stock_quantity,
                              })
                            }
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-center block">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={product.track_inventory}
                      onCheckedChange={(checked) => handleTrackingChange(product.id, checked)}
                      disabled={isUpdating || !canEditCatalog}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVariantProduct(product)}
                    >
                      <Layers className="w-3.5 h-3.5 mr-1.5" />
                      {product.variants.length}
                    </Button>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setHistoryProduct(product)}
                      title="Ver movimientos de stock"
                    >
                      <History className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLabelsProduct(product)}
                      title="Imprimir etiquetas (una por talla)"
                    >
                      <Tag className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {variantProduct && (
        <VariantsDialog
          open={!!variantProduct}
          onOpenChange={(o) => !o && setVariantProduct(null)}
          productId={variantProduct.id}
          productName={variantProduct.name}
          basePrice={variantProduct.price}
          onChanged={refreshProducts}
        />
      )}

      <StockMovementsDialog product={historyProduct} onClose={() => setHistoryProduct(null)} />
      <LabelPrintDialog
        open={labelsProduct !== null}
        onOpenChange={(o) => !o && setLabelsProduct(null)}
        title={`Etiquetas · ${labelsProduct?.name ?? ''}`}
        items={labelItems}
      />
      <StockAdjustDialog target={adjustTarget} onClose={() => setAdjustTarget(null)} onDone={refreshProducts} />
    </Card>
  );

}
