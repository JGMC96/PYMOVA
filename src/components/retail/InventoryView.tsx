import { useState } from 'react';
import { Package, RefreshCw, Edit2, Check, X, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export function InventoryView() {
  const { products, isLoading, isUpdating, updateStock, toggleTracking, refreshProducts } = useInventory();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [variantProduct, setVariantProduct] = useState<ProductWithStock | null>(null);


  const startEditing = (productId: string, currentStock: number) => {
    setEditingId(productId);
    setEditValue(currentStock.toString());
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
  };

  const saveStock = async (productId: string) => {
    const newQuantity = parseInt(editValue, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
      cancelEditing();
      return;
    }
    await updateStock(productId, newQuantity);
    setEditingId(null);
    setEditValue('');
  };

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
                      editingId === product.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-20 h-8 text-center"
                            min={0}
                            autoFocus
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-success"
                            onClick={() => saveStock(product.id)}
                            disabled={isUpdating}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={cancelEditing}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <Badge
                            variant={product.stock_quantity > 10 ? 'secondary' : product.stock_quantity > 0 ? 'outline' : 'destructive'}
                          >
                            {product.stock_quantity}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => startEditing(product.id, product.stock_quantity)}
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )
                    ) : (
                      <span className="text-muted-foreground text-center block">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={product.track_inventory}
                      onCheckedChange={(checked) => handleTrackingChange(product.id, checked)}
                      disabled={isUpdating}
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
    </Card>
  );

}
